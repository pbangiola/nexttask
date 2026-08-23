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
    return task;
}

//create a task object from a user provided string
function createTask(name, values = {}) {
    return ensureTask({ id: values.id, name, estimatedTimeMs: values.estimatedTimeMs,
        actualTimeMs: values.actualTimeMs, completed: values.completed, status: values.status,
        created: values.created, started: values.started, completedTime: values.completedTime,
        lastChanged: values.lastChanged });
}

//tasklist indexing functions
//separate incomplete tasks from complete tasks
function incompleteTasks() {
    sortedTasks.forEach(ensureTask);
    return sortedTasks.filter(task => !task.completed);
}
//identify the first incomplete task in the taak list
function firstIncompleteTask() { return incompleteTasks()[0] || null; }
//identify the task the user is focused on now
function currentTask() { return sortedTasks.find(task => task.id === activeTaskId && !task.completed) || firstIncompleteTask(); }


//Initialize task sorting
async function startSorting() {
    const enteredNames = parseTaskEntryText(el('tasks').value);
    const names = resolveDuplicateTaskNames(enteredNames);
    if (!names.length) { alert('Please enter at least one task.'); return; }

    currentSortNames = [...names];
    const workTasks = names.map(name => createTask(name));
    const sortStartedAtMs = Date.now();
    const estimatedMs = estimatedSortingTimeMs(names.length);
    const sortTask = createTask('Sort Tasks', {
        estimatedTimeMs: estimatedMs,
        actualTimeMs: 0,
        completed: false,
        status: 'active',
        created: sortStartedAtMs,
        started: sortStartedAtMs,
        lastChanged: sortStartedAtMs
    });

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
    save('timing-gateway');
    showTimingGateway();
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

        // Before merging two already-sorted halves, compare the boundary items.
        // If the last item in the left half belongs before the first item in the
        // right half, every item in left is already before every item in right,
        // so the two halves form one ordered run and can be concatenated.
        function checkRunBoundary() {
            if (runId !== sortRunId) { finish([]); return; }
            if (!left.length || !right.length) { finish([...left, ...right]); return; }

            const leftBoundary = left[left.length - 1];
            const rightBoundary = right[0];
            task1.textContent = leftBoundary.name;
            task2.textContent = rightBoundary.name;

            task1.onclick = () => {
                if (runId !== sortRunId) { finish([]); return; }
                finish([...left, ...right]);
            };
            task2.onclick = () => {
                if (runId !== sortRunId) { finish([]); return; }
                nextMergeComparison();
            };
        }

        checkRunBoundary();
    });
}

//trigger work on the next task in the sorted list
function beginWork(){ const task=firstIncompleteTask(); if(!task){showCompletion();return;} activeTaskId=task.id; if(task.estimatedTimeMs<=0) showSingleTaskEstimate(task); else showFocus(task); }



//initialize
function init(){
    bindEvents();
    const restored=restoreLocalState();

    if (!restored || !sortedTasks.length) {
        showModeSelect();
        return;
    }

    if (hasHardStop() && Date.now() >= hardStopAtMs && restored.view !== 'session-ended') {
        handleHardStop();
        return;
    }

    startHardStopWatch();
    const active=currentTask();

    if (restored.view==='focus'&&active?.lastChanged!==null) showFocus(active);
    else if (restored.view==='timing-entry') showSequentialTiming(0);
    else if (restored.view==='timing-gateway') showTimingGateway();
    else if (restored.view==='completion') showCompletion();
    else if (restored.view==='session-ended') showSessionEnded();
    else if (restored.view==='stop-checklist') showStopChecklist();
    else showDashboard();
}
document.addEventListener('DOMContentLoaded',init);
