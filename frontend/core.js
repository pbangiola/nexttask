'use strict';

//define, upate, and maintain a task object
function ensureTask(task) {
    const now = Date.now();
    task.id ||= createId('task');
    task.name = String(task.name || '').trim();
    task.estimatedTimeMs = Math.max(0, Number(task.estimatedTimeMs || 0));
    task.actualTimeMs = Math.max(0, Number(task.actualTimeMs || 0));
    task.completed = Boolean(task.completed || task.completedTime || task.status === 'completed');
    task.status = task.completed ? 'completed' : (task.status || 'pending');
    task.created = Number(task.created || now);
    task.started = task.started ?? null;
    task.completedTime = task.completedTime ?? null;
    task.lastChanged = task.lastChanged ?? null;
    task.blockedByTaskId = task.blockedByTaskId ?? null;
    return task;
}

//create a task object from a user provided string
function createTask(name, values = {}) {
    return ensureTask({ id: values.id, name, estimatedTimeMs: values.estimatedTimeMs,
        actualTimeMs: values.actualTimeMs, completed: values.completed, status: values.status,
        created: values.created, started: values.started, completedTime: values.completedTime,
        lastChanged: values.lastChanged, blockedByTaskId: values.blockedByTaskId });
}

//tasklist indexing functions
//separate incomplete tasks from complete tasks
function incompleteTasks() {
    sortedTasks.forEach(ensureTask);
    return sortedTasks.filter(task => !task.completed && task.status !== 'cancelled');
}
//identify the first incomplete task in the taak list
function firstIncompleteTask() { return incompleteTasks().find(task => window.FocusDurability.eligible(task)) || null; }
//identify the task the user is focused on now
function currentTask() { return sortedTasks.find(task => task.id === activeTaskId && !task.completed) || firstIncompleteTask(); }


//Initialize task sorting
async function startSorting() {
    const parsed = parseTaskEntries(el('tasks').value);
    if (parsed.invalid.length) return alert('Could not read: ' + parsed.invalid.join(' | '));
    const entries = resolveDuplicateEntries(parsed.entries);
    if (!entries.length) return alert('Please enter at least one task.');
    const workTasks = entries.map(entry => createTask(entry.name, entry));
    window.currentWorkProjectContext = null;

    for (const task of workTasks) {
        const minutes = task.estimatedTimeMs / 60_000;
        if (minutes > DECOMPOSITION_PROMPT_MINUTES) {
            const keepWhole = confirm(
                `“${task.name}” is estimated at ${Math.round(minutes)} minutes.\n\n` +
                'Tasks over 20 minutes may actually be small projects. Consider splitting it into smaller, concrete tasks.\n\n' +
                'Choose OK to keep it as one task, or Cancel to go back and split it.'
            );
            if (!keepWhole) return;
        }
    }

    currentSortNames = workTasks.map(task => task.name);
    const sortStartedAtMs = Date.now();
    const estimatedMs = estimatedSortingTimeMs(workTasks.length);
    const sortTask = createTask('Sort Tasks', {
        estimatedTimeMs: estimatedMs,
        actualTimeMs: 0,
        completed: false,
        status: 'active',
        created: sortStartedAtMs,
        started: sortStartedAtMs,
        lastChanged: sortStartedAtMs
    });

    sortTask.isSortingOverhead = true;
    sortTask.independentlyActionable = false;
    window.FocusDurability.newWork();
    sortedTasks = [sortTask, ...workTasks];
    activeTaskId = sortTask.id;
    sortStartedAt = sortStartedAtMs;
    const runId = ++sortRunId;

    hide(el('taskInput'));
    show(el('startOverBtn'));
    prepareSortingDisplay(sortTask);
    save('sorting');

    let sortedWorkTasks = workTasks;
    if (!el('skipSortCheckbox').checked) {
        sortedWorkTasks = await interactiveMergeSort(workTasks, runId);
        if (runId !== sortRunId) return;
    }

    const finishedAtMs = Date.now();
    clearInterval(timerInterval);
    completeTask(sortTask, finishedAtMs);
    sortedTasks = [sortTask, ...sortedWorkTasks];
    activeTaskId = firstIncompleteTask()?.id || null;
    hide(el('taskCompare'));
    await save('dashboard');
    if(!el('skipSortCheckbox').checked)await window.NextPlan?.recordImportance(sortedWorkTasks);
    collectMissingEstimates(sortedWorkTasks, () => showDashboard(), () => showTaskInput());
}

//core merge sort algorithm step 1
async function interactiveMergeSort(items, runId) {
    if (runId !== sortRunId || items.length <= 1) return items;
    const middle = Math.floor(items.length / 2);
    const left = await interactiveMergeSort(items.slice(0, middle), runId);
    const right = await interactiveMergeSort(items.slice(middle), runId);
    if (runId !== sortRunId) return [];
    return mergeWithChoices(left, right, runId);
}

//core merge sort algorithm recursive
function mergeWithChoices(left, right, runId) {
    return new Promise(resolve => {
        const merged = [];
        const compare = el('taskCompare');
        const task1 = el('task1');
        const task2 = el('task2');

        show(compare);
        hide(el('taskInput'));
        show(el('startOverBtn'));

        function finish(result) {
            hide(compare);
            task1.onclick = null; task2.onclick = null;
            resolve(result);
        }

        function chooseMerge(side) {
            if (runId !== sortRunId) { finish([]); return; }
            merged.push(side === 'left' ? left.shift() : right.shift());
            nextMergeComparison();
        }

        function nextMergeComparison() {
            if (runId !== sortRunId) { finish([]); return; }
            if (!left.length || !right.length) {
                finish([...merged, ...left, ...right]);
                return;
            }
            task1.textContent = left[0].name;
            task2.textContent = right[0].name;
            task1.onclick = () => chooseMerge('left');
            task2.onclick = () => chooseMerge('right');
        }

        // For short runs, the shortcut comparisons cost more than they save and
        // can make the interaction feel odd. Merge normally if either side has
        // three or fewer items.
        if (left.length <= 3 || right.length <= 3) {
            nextMergeComparison();
            return;
        }

        // Long-run shortcut 1: compare first(left) with last(right). If the user
        // says last(right) comes first, every item in right must come before every
        // item in left, so concatenate right + left.
        function checkRightEntirelyBeforeLeft() {
            if (runId !== sortRunId) { finish([]); return; }
            task1.textContent = left[0].name;
            task2.textContent = right[right.length - 1].name;

            task1.onclick = () => checkLeftEntirelyBeforeRight();
            task2.onclick = () => finish([...right, ...left]);
        }

        // Long-run shortcut 2: compare first(right) with last(left). If the user
        // says last(left) comes first, every item in left must come before every
        // item in right, so concatenate left + right. Otherwise the runs overlap
        // and we fall back to the normal merge.
        function checkLeftEntirelyBeforeRight() {
            if (runId !== sortRunId) { finish([]); return; }
            task1.textContent = right[0].name;
            task2.textContent = left[left.length - 1].name;

            task1.onclick = () => nextMergeComparison();
            task2.onclick = () => finish([...left, ...right]);
        }

        checkRightEntirelyBeforeLeft();
    });
}

//trigger work on the next task in the sorted list
function beginWork(){ const task=firstIncompleteTask(); if(!task){if(incompleteTasks().length)showDashboard();else window.FocusDurability.finish();return;} return showFocus(task); }



//initialize
function init(){ return window.FocusDurability.init(); }
