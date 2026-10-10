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
    return sortedTasks.filter(task => !task.completed);
}
//identify the first incomplete task in the taak list
function firstIncompleteTask() { return incompleteTasks()[0] || null; }
//identify the task the user is focused on now
function currentTask() { return sortedTasks.find(task => task.id === activeTaskId && !task.completed) || firstIncompleteTask(); }


//Initialize task sorting
async function startSorting() {
    const rawText = el('tasks').value;
    const timed = parseTimedTaskEntries(rawText);
    let workTasks;

    if (!timed.invalid.length && timed.entries.length) {
        const names = resolveDuplicateTaskNames(timed.entries.map(entry => entry.name));
        if (!names.length) return;

        const remainingEntries = [...timed.entries];
        workTasks = names.map(name => {
            const baseName = name.replace(/ again(?: \d+)?$/i, '');
            let entryIndex = remainingEntries.findIndex(entry => duplicateKey(entry.name) === duplicateKey(baseName));
            if (entryIndex < 0) entryIndex = 0;
            const [entry] = remainingEntries.splice(entryIndex, 1);
            return createTask(name, { estimatedTimeMs: entry?.estimatedTimeMs || 0 });
        });
    } else {
        const names = resolveDuplicateTaskNames(parseTaskEntryText(rawText));
        if (!names.length) {
            alert('Please enter at least one task.');
            return;
        }
        workTasks = names.map(name => createTask(name));
    }

    currentSortNames = workTasks.map(task => task.name);

    // Untimed input is deliberate: collect estimates one task at a time before
    // sorting. This keeps mobile entry terse while still requiring every task
    // to have an estimate before work begins.
    if (workTasks.some(task => task.estimatedTimeMs <= 0)) {
        sortedTasks = workTasks;
        activeTaskId = workTasks[0]?.id || null;
        timingEntryNextStep = 'sort-new-list';
        hide(el('taskInput'));
        show(el('startOverBtn'));
        saveLocal('timing-entry');
        showSequentialTiming(0);
        return;
    }

    await sortPreparedTaskList(workTasks);
}

async function sortPreparedTaskList(workTasks = sortedTasks) {
    timingEntryNextStep = null;

    for (const task of workTasks) {
        const minutes = task.estimatedTimeMs / 60_000;
        if (minutes > DECOMPOSITION_PROMPT_MINUTES) {
            const keepWhole = confirm(
                `“${task.name}” is estimated at ${Math.round(minutes)} minutes.\n\n` +
                'Tasks over 20 minutes may actually be small projects. Consider splitting it into smaller, concrete tasks.\n\n' +
                'Choose OK to keep it as one task, or Cancel to go back and split it.'
            );
            if (!keepWhole) {
                el('tasks').value = workTasks.map(item => item.name).join('\n');
                showTaskInput();
                return;
            }
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
    save('dashboard');
    showDashboard();
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
function beginWork(){ const task=firstIncompleteTask(); if(!task){showCompletion();return;} activeTaskId=task.id; if(task.estimatedTimeMs<=0) showSingleTaskEstimate(task); else showFocus(task); }



//initialize
async function init(){
    bindEvents();
    const restored=restoreLocalState();
    if (restored && sortedTasks.length && window.TaskGraph) {
        try {
            const session=await window.TaskGraph.openWorkSession();
            if (session) {
                const detail=await window.TaskGraph.getWorkSession(session.id);
                const ranks=new Map((detail.items||[]).map((item,index)=>[item.id,index]));
                const queued=sortedTasks.filter(task=>ranks.has(task.id));
                if (queued.length) {
                    sortedTasks=queued.sort((a,b)=>ranks.get(a.id)-ranks.get(b.id));
                    window.activeWorkSessionId=session.id;
                    await window.TaskGraphTiming?.restore(session.id);
                    if(!sortedTasks.some(task=>task.id===activeTaskId)) activeTaskId=firstIncompleteTask()?.id||null;
                }
            }
        } catch(error) { console.warn('Server session recovery unavailable; using local snapshot:',error); }
    }

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
    else if (restored.view==='timing-gateway') showSequentialTiming(0);
    else if (restored.view==='completion') showCompletion();
    else if (restored.view==='session-ended') showSessionEnded();
    else if (restored.view==='stop-checklist') showStopChecklist();
    else showDashboard();
}
document.addEventListener('DOMContentLoaded',init);
