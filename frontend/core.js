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
async function startSorting(){const parsed=parseTimedTaskEntries(el('tasks').value);if(parsed.invalid.length){alert('Every task needs a time estimate. Try “Email Sam, 10m” or “Write report, 1h 30m”.\n\nCould not read: '+parsed.invalid.join(' | '));return;}if(!parsed.entries.length){alert('Please enter at least one task with a time estimate.');return;}const names=resolveDuplicateTaskNames(parsed.entries.map(e=>e.name));if(!names.length)return;const remaining=[...parsed.entries],workTasks=names.map(name=>{const base=name.replace(/ again(?: \d+)?$/i,'');let i=remaining.findIndex(e=>duplicateKey(e.name)===duplicateKey(base));if(i<0)i=0;const [entry]=remaining.splice(i,1);return createTask(name,{estimatedTimeMs:entry?.estimatedTimeMs||0});});for(const task of workTasks){const minutes=task.estimatedTimeMs/60000;if(minutes>DECOMPOSITION_PROMPT_MINUTES&&!confirm(`“${task.name}” is estimated at ${Math.round(minutes)} minutes.\n\nTasks over 20 minutes may actually be small projects. Consider splitting it into smaller, concrete tasks.\n\nChoose OK to keep it as one task, or Cancel to go back and split it.`))return;}currentSortNames=workTasks.map(t=>t.name);const started=Date.now(),sortTask=createTask('Sort Tasks',{estimatedTimeMs:estimatedSortingTimeMs(workTasks.length),status:'active',created:started,started,lastChanged:started});sortedTasks=[sortTask,...workTasks];activeTaskId=sortTask.id;sortStartedAt=started;const runId=++sortRunId;hide(el('taskInput'));show(el('startOverBtn'));prepareSortingDisplay(sortTask);save('sorting');let sorted=workTasks;if(!el('skipSortCheckbox').checked){sorted=await interactiveMergeSort(workTasks,runId);if(runId!==sortRunId)return;}clearInterval(timerInterval);completeTask(sortTask,Date.now());sortedTasks=[sortTask,...sorted];activeTaskId=firstIncompleteTask()?.id||null;hide(el('taskCompare'));save('dashboard');showDashboard();}

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
    else if (restored.view==='timing-gateway') showSequentialTiming(0);
    else if (restored.view==='completion') showCompletion();
    else if (restored.view==='session-ended') showSessionEnded();
    else if (restored.view==='stop-checklist') showStopChecklist();
    else showDashboard();
}
document.addEventListener('DOMContentLoaded',init);
