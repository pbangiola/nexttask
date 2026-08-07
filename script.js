'use strict';

const API_BASE_URL = 'https://nexttask-production.up.railway.app';
const MAX_TASK_MINUTES = 60;
const TEN_MINUTES_MS = 10 * 60 * 1000;
const LOCAL_STATE_KEY = 'taskSorterSession_fallback';

let sessionId = localStorage.getItem('taskSorterSessionId') || createId('session');
let userId = localStorage.getItem('taskSorterUserId') || createId('user');
localStorage.setItem('taskSorterSessionId', sessionId);
localStorage.setItem('taskSorterUserId', userId);

let sortedTasks = [];
let activeTaskId = null;
let timerInterval = null;
let totalAvailableTimeMs = 0;
let sessionStartedAtMs = 0;
let hardStopAtMs = 0;
let hardStopInterval = null;
let hardStopHandled = false;
let endConstraint = '';
let sortStartedAt = null;
let currentSortNames = [];
let sortRunId = 0;

function createId(prefix) {
    const random = globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2, 11);
    return `${prefix}_${random}`;
}

function el(id) { return document.getElementById(id); }
function show(element) { element?.classList.remove('hidden'); }
function hide(element) { element?.classList.add('hidden'); }
function clearDynamic() { const c = el('dynamicContainer'); if (c) c.innerHTML = ''; return c; }
function hideStaticScreens() { ['modeSelect','workChoiceStep','timeConstraintInput','taskInput','taskCompare'].forEach(id => hide(el(id))); }

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

function createTask(name, values = {}) {
    return ensureTask({ id: values.id, name, estimatedTimeMs: values.estimatedTimeMs,
        actualTimeMs: values.actualTimeMs, completed: values.completed, status: values.status,
        created: values.created, started: values.started, completedTime: values.completedTime,
        lastChanged: values.lastChanged, blockedByTaskId: values.blockedByTaskId });
}

function incompleteTasks() { sortedTasks.forEach(ensureTask); return sortedTasks.filter(task => !task.completed); }
function firstIncompleteTask() { return incompleteTasks()[0] || null; }
function currentTask() { return sortedTasks.find(task => task.id === activeTaskId && !task.completed) || firstIncompleteTask(); }

function checkpointTask(task, now = Date.now()) {
    ensureTask(task);
    if (task.lastChanged !== null) {
        task.actualTimeMs += Math.max(0, now - task.lastChanged);
        task.lastChanged = now;
    }
}
function startTaskClock(task, now = Date.now()) { ensureTask(task); if (task.started === null) task.started = now; task.lastChanged = now; task.status = 'active'; activeTaskId = task.id; }
function pauseTaskClock(task, now = Date.now()) { checkpointTask(task, now); task.lastChanged = null; if (!task.completed && task.status !== 'blocked') task.status = 'pending'; }
function completeTask(task, now = Date.now()) { checkpointTask(task, now); task.lastChanged = null; task.completed = true; task.completedTime = now; task.status = 'completed'; task.blockedByTaskId = null; }

function formatDuration(ms, alwaysHours = false) {
    const totalSeconds = Math.floor(Math.abs(ms) / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const mmss = `${String(minutes).padStart(2,'0')}:${String(seconds).padStart(2,'0')}`;
    return alwaysHours || hours > 0 ? `${hours}:${mmss}` : mmss;
}
function allocatedTimeMs() { return incompleteTasks().reduce((sum, task) => sum + Math.max(0, task.estimatedTimeMs || 0), 0); }
function estimatedComparisonCount(taskCount) { return taskCount <= 1 ? 0 : Math.ceil(taskCount * Math.log2(taskCount)); }
function estimatedSortingTimeMs(taskCount) { return Math.ceil(3_000 * taskCount * Math.log2(Math.max(1, taskCount))); }

function hasHardStop() {
    return Number.isFinite(hardStopAtMs) && hardStopAtMs > 0;
}

function sessionTimeRemainingMs(now = Date.now()) {
    return hasHardStop() ? hardStopAtMs - now : null;
}

function beginTimedSession(durationMs, now = Date.now()) {
    totalAvailableTimeMs = Math.max(0, Number(durationMs || 0));
    sessionStartedAtMs = totalAvailableTimeMs > 0 ? now : 0;
    hardStopAtMs = totalAvailableTimeMs > 0 ? now + totalAvailableTimeMs : 0;
    hardStopHandled = false;
    startHardStopWatch();
}

function clearSessionTiming() {
    clearInterval(hardStopInterval);
    hardStopInterval = null;
    totalAvailableTimeMs = 0;
    sessionStartedAtMs = 0;
    hardStopAtMs = 0;
    hardStopHandled = false;
}

function startHardStopWatch() {
    clearInterval(hardStopInterval);
    hardStopInterval = null;

    if (!hasHardStop() || hardStopHandled) return;

    const checkHardStop = () => {
        if (Date.now() >= hardStopAtMs) handleHardStop();
    };

    checkHardStop();
    if (!hardStopHandled) hardStopInterval = setInterval(checkHardStop, 250);
}

function handleHardStop() {
    if (hardStopHandled || !hasHardStop()) return;

    hardStopHandled = true;
    clearInterval(hardStopInterval);
    hardStopInterval = null;
    clearInterval(timerInterval);

    const task = currentTask();
    if (task && task.lastChanged !== null) {
        pauseTaskClock(task, hardStopAtMs);
    }

    activeTaskId = firstIncompleteTask()?.id || null;
    save('session-ended');
    showSessionEnded();
}

function localSnapshot(view) {
    return {
        sortedTasks,
        activeTaskId,
        totalAvailableTimeMs,
        sessionStartedAtMs,
        hardStopAtMs,
        endConstraint,
        view,
        updatedAt: Date.now()
    };
}
function saveLocal(view = inferView()) { localStorage.setItem(LOCAL_STATE_KEY, JSON.stringify(localSnapshot(view))); }
function serverPayload() {
    return {
        userId,
        totalAvailableTimeMs,
        sessionStartedAtMs,
        hardStopAtMs,
        endConstraint,
        tasks: sortedTasks.map((task,index) => {
        ensureTask(task);
        return { id: task.id, name: task.name, status: task.completed ? 'completed' : task.status,
            estimatedTimeMs: task.estimatedTimeMs, actualTimeMs: task.actualTimeMs, position: index + 1,
            created: task.created, started: task.started, completedTime: task.completedTime,
            lastChanged: task.lastChanged, blockedByTaskId: task.blockedByTaskId };
        })
    };
}
function backupToServer() {
    fetch(`${API_BASE_URL}/api/session/${encodeURIComponent(sessionId)}/tasks`, { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(serverPayload()) })
        .then(response => { if (!response.ok) throw new Error(`Backup failed (${response.status})`); })
        .catch(error => console.warn('Server backup failed; browser state is safe:', error));
}
function save(view = inferView()) { saveLocal(view); backupToServer(); }
function inferView() {
    if (el('focusScreen')) return 'focus';
    if (el('dashboardScreen')) return 'dashboard';
    if (!el('taskCompare')?.classList.contains('hidden')) return 'sorting';
    if (el('timingGatewayScreen')) return 'timing-gateway';
    if (el('timingEntryScreen')) return 'timing-entry';
    if (el('completionScreen')) return 'completion';
    if (el('sessionEndedScreen')) return 'session-ended';
    if (el('stopChecklistScreen')) return 'stop-checklist';
    if (!el('taskInput')?.classList.contains('hidden')) return 'input';
    if (!el('timeConstraintInput')?.classList.contains('hidden')) return 'time-constraint';
    if (!el('workChoiceStep')?.classList.contains('hidden')) return 'work-choice';
    return 'mode-select';
}
function restoreLocalState() {
    const raw = localStorage.getItem(LOCAL_STATE_KEY); if (!raw) return false;
    try {
        const state = JSON.parse(raw);
        sortedTasks = Array.isArray(state.sortedTasks) ? state.sortedTasks.map(ensureTask) : [];
        activeTaskId = state.activeTaskId || null;
        totalAvailableTimeMs = Math.max(0, Number(state.totalAvailableTimeMs || 0));
        sessionStartedAtMs = Math.max(0, Number(state.sessionStartedAtMs || 0));
        hardStopAtMs = Math.max(0, Number(state.hardStopAtMs || 0));
        endConstraint = String(state.endConstraint || '');
        hardStopHandled = state.view === 'session-ended';
        return state;
    }
    catch (error) { console.warn('Local session could not be restored:', error); return false; }
}

function showModeSelect() { hideStaticScreens(); clearDynamic(); show(el('modeSelect')); hide(el('stopWorkingBtn')); hide(el('startOverBtn')); }
function showWorkChoice() { hideStaticScreens(); clearDynamic(); show(el('workChoiceStep')); show(el('startOverBtn')); }
function showTimeConstraint() { hideStaticScreens(); clearDynamic(); show(el('timeConstraintInput')); show(el('startOverBtn')); el('availableTime').value = totalAvailableTimeMs ? Math.round(totalAvailableTimeMs/60000) : ''; el('endConstraint').value = endConstraint; }
function showTaskInput() { hideStaticScreens(); clearDynamic(); show(el('taskInput')); show(el('startOverBtn')); updateCapacityMessage(); }

function updateCapacityMessage() {
    const textarea = el('tasks'); if (!textarea) return;
    const tasks = parseTaskEntryText(textarea.value);
    let message = el('capacityInfoMsg');
    if (!message) { message = document.createElement('p'); message.id='capacityInfoMsg'; message.style.fontWeight='bold'; textarea.insertAdjacentElement('afterend', message); }
    if (!totalAvailableTimeMs) { message.textContent=''; return; }
    const estimated = tasks.length * TEN_MINUTES_MS;
    message.textContent = `Estimated capacity: ${Math.round(estimated/60000)} / ${Math.round(totalAvailableTimeMs/60000)} minutes.`;
    message.style.color = estimated > totalAvailableTimeMs ? '#d32f2f' : '#2e7d32';
}
function parseTaskEntryText(text) {
    const trimmed = String(text || '').trim();
    if (!trimmed) return [];
    const pieces = trimmed.includes('\n') ? trimmed.split(/\r?\n/) : trimmed.split(',');
    return pieces
        .map(value => value.replace(/^\s*\d+[.)]\s*/, '').trim())
        .filter(Boolean);
}

function parsePlainTaskText(text) {
    return [...new Set(parseTaskEntryText(text))];
}

function duplicateKey(name) {
    return String(name || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

function nextAvailableAgainName(baseName, usedKeys) {
    const cleanBase = String(baseName || '').trim().replace(/\s+/g, ' ');
    let candidate = `${cleanBase} again`;
    let suffix = 2;

    while (usedKeys.has(duplicateKey(candidate))) {
        candidate = `${cleanBase} again ${suffix}`;
        suffix += 1;
    }

    return candidate;
}

function resolveDuplicateTaskNames(names) {
    const resolved = [];
    const usedKeys = new Set();

    names.forEach(rawName => {
        const name = String(rawName || '').trim().replace(/\s+/g, ' ');
        const key = duplicateKey(name);

        if (!usedKeys.has(key)) {
            resolved.push(name);
            usedKeys.add(key);
            return;
        }

        const renamed = nextAvailableAgainName(name, usedKeys);
        const keepDuplicate = confirm(
            `“${name}” appears more than once.\n\n` +
            `Keep this copy as “${renamed}”?\n\n` +
            'Choose Cancel to remove the duplicate.'
        );

        if (keepDuplicate) {
            resolved.push(renamed);
            usedKeys.add(duplicateKey(renamed));
        }
    });

    return resolved;
}

function prepareSortingDisplay(sortTask) {
    const compare = el('taskCompare');
    let taskHeading = el('sortTaskHeading');
    let sortTimer = el('sortTaskTimer');

    if (!taskHeading) {
        taskHeading = document.createElement('h2');
        taskHeading.id = 'sortTaskHeading';
        compare.insertBefore(taskHeading, compare.firstChild);
    }

    if (!sortTimer) {
        sortTimer = document.createElement('p');
        sortTimer.id = 'sortTaskTimer';
        sortTimer.style.fontSize = '24px';
        sortTimer.style.fontWeight = 'bold';
        taskHeading.insertAdjacentElement('afterend', sortTimer);
    }

    taskHeading.textContent = `Current Task: ${sortTask.name}`;

    function renderSortingTimer() {
        checkpointTask(sortTask);
        const remainingMs = sortTask.estimatedTimeMs - sortTask.actualTimeMs;
        sortTimer.style.color = remainingMs >= 0 ? 'green' : 'red';
        sortTimer.textContent = remainingMs >= 0
            ? `${formatDuration(remainingMs)} remaining`
            : `${formatDuration(remainingMs)} overdue`;
        saveLocal('sorting');
    }

    renderSortingTimer();
    clearInterval(timerInterval);
    timerInterval = setInterval(renderSortingTimer, 1_000);
}

async function interactiveMergeSort(items, runId) {
    if (runId !== sortRunId || items.length <= 1) return items;
    const middle = Math.floor(items.length / 2);
    const left = await interactiveMergeSort(items.slice(0, middle), runId);
    const right = await interactiveMergeSort(items.slice(middle), runId);
    if (runId !== sortRunId) return [];
    return mergeWithChoices(left, right, runId);
}

function mergeWithChoices(left, right, runId) {
    return new Promise(resolve => {
        const merged = [];
        const compare = el('taskCompare');
        const task1 = el('task1');
        const task2 = el('task2');

        show(compare);
        hide(el('taskInput'));
        show(el('startOverBtn'));

        function choose(side) {
            if (runId !== sortRunId) { resolve([]); return; }
            merged.push(side === 'left' ? left.shift() : right.shift());
            next();
        }

        function next() {
            if (runId !== sortRunId) { hide(compare); resolve([]); return; }
            if (!left.length || !right.length) {
                hide(compare);
                resolve([...merged, ...left, ...right]);
                return;
            }
            task1.textContent = left[0].name;
            task2.textContent = right[0].name;
            task1.onclick = () => choose('left');
            task2.onclick = () => choose('right');
        }
        next();
    });
}

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

function showTimingGateway() {
    hideStaticScreens(); hide(el('startOverBtn')); const container=clearDynamic(); const screen=document.createElement('div'); screen.id='timingGatewayScreen';
    const heading=document.createElement('h2'); heading.textContent='Do you want to set timings now?';
    const yes=document.createElement('button'); yes.textContent='Yes'; yes.onclick=()=>showSequentialTiming(0);
    const no=document.createElement('button'); no.textContent='No'; no.onclick=showDashboard;
    screen.append(heading,yes,no); container.appendChild(screen); saveLocal('timing-gateway');
}
function showSequentialTiming(startIndex = 0) {
    clearInterval(timerInterval);

    const pending = incompleteTasks();
    const index = pending.findIndex((task, i) => i >= startIndex && task.estimatedTimeMs <= 0);
    if (index === -1) {
        showDashboard();
        return;
    }

    const task = pending[index];
    hideStaticScreens();
    show(el('startOverBtn'));

    const container = clearDynamic();
    const screen = document.createElement('div');
    screen.id = 'timingEntryScreen';

    const heading = document.createElement('h2');
    heading.textContent = `Current Task: ${task.name}`;

    const timerLabel = document.createElement('p');
    timerLabel.textContent = 'Time to work with:';
    timerLabel.style.marginBottom = '4px';

    const allocationTimer = document.createElement('p');
    allocationTimer.id = 'timer';
    allocationTimer.style.fontSize = '24px';
    allocationTimer.style.fontWeight = 'bold';
    allocationTimer.style.color = 'green';
    allocationTimer.style.marginTop = '0';

    const prompt = document.createElement('p');
    prompt.textContent = `Estimate time for task ${index + 1} of ${pending.length}.`;

    const input = document.createElement('input');
    input.type = 'number';
    input.min = '1';

    const next = document.createElement('button');
    next.textContent = index === pending.length - 1 ? 'Finish and View List' : 'Save & Next';

    function remainingPlanningTimeMs(now = Date.now()) {
        const sessionRemaining = sessionTimeRemainingMs(now);
        return sessionRemaining === null ? null : sessionRemaining - allocatedTimeMs();
    }

    function updatePlanningTimer() {
        const remainingMs = remainingPlanningTimeMs();

        if (remainingMs === null) {
            allocationTimer.textContent = 'No overall time limit';
            input.max = String(MAX_TASK_MINUTES);
            input.placeholder = `1-${MAX_TASK_MINUTES} minutes`;
            next.disabled = false;
            return;
        }

        if (remainingMs <= 0) {
            clearInterval(timerInterval);
            saveLocal('dashboard');
            showDashboard();
            return;
        }

        allocationTimer.textContent = formatDuration(remainingMs);

        const maxWholeMinutes = Math.min(MAX_TASK_MINUTES, Math.floor(remainingMs / 60_000));
        if (maxWholeMinutes < 1) {
            input.max = '0';
            input.placeholder = 'Less than 1 minute remains';
            input.disabled = true;
            next.disabled = true;
            return;
        }

        input.disabled = false;
        next.disabled = false;
        input.max = String(maxWholeMinutes);
        input.placeholder = `1-${maxWholeMinutes} minutes`;
    }

    next.onclick = () => {
        const minutes = Number.parseInt(input.value, 10);
        const remainingMs = remainingPlanningTimeMs();
        const maxWholeMinutes = remainingMs === null
            ? MAX_TASK_MINUTES
            : Math.min(MAX_TASK_MINUTES, Math.floor(remainingMs / 60_000));

        if (!Number.isFinite(minutes) || minutes < 1 || minutes > maxWholeMinutes) {
            alert(`Enter a number from 1 to ${Math.max(1, maxWholeMinutes)}.`);
            updatePlanningTimer();
            return;
        }

        task.estimatedTimeMs = minutes * 60_000;
        clearInterval(timerInterval);
        saveLocal('timing-entry');
        showSequentialTiming(index + 1);
    };

    screen.append(heading, timerLabel, allocationTimer, prompt, input, next);
    container.appendChild(screen);

    updatePlanningTimer();
    timerInterval = setInterval(updatePlanningTimer, 1_000);
    saveLocal('timing-entry');
}

function showDashboard() {
    hideStaticScreens(); hide(el('stopWorkingBtn')); show(el('startOverBtn')); const container=clearDynamic(); const screen=document.createElement('div'); screen.id='dashboardScreen';
    const heading=document.createElement('h2'); heading.textContent='Your Task List'; screen.appendChild(heading);
    const list=document.createElement('ol'); sortedTasks.forEach(task=>{ ensureTask(task); const item=document.createElement('li'); const estimate=task.estimatedTimeMs?` — ${Math.round(task.estimatedTimeMs/60000)} min`:''; const state=task.completed?' ✓':task.status==='blocked'?' — blocked':''; item.textContent=`${task.name}${estimate}${state}`; list.appendChild(item); }); screen.appendChild(list);
    const capacity=document.createElement('p'); capacity.textContent=`Allocated: ${Math.round(allocatedTimeMs()/60000)} minutes`+(totalAvailableTimeMs?` of ${Math.round(totalAvailableTimeMs/60000)} available`:''); screen.appendChild(capacity);
    const work=document.createElement('button'); work.textContent='Get to Work'; work.onclick=beginWork; screen.appendChild(work);
    const exportButton=document.createElement('button'); exportButton.textContent='Download Task List'; exportButton.onclick=exportCsv; screen.appendChild(exportButton);
    container.appendChild(screen); save('dashboard');
}
function beginWork(){ const task=firstIncompleteTask(); if(!task){showCompletion();return;} activeTaskId=task.id; if(task.estimatedTimeMs<=0) showSingleTaskEstimate(task); else showFocus(task); }
function showSingleTaskEstimate(task){ hideStaticScreens(); hide(el('startOverBtn')); const container=clearDynamic(); const screen=document.createElement('div'); screen.id='deadlinePage'; const heading=document.createElement('h2'); heading.textContent=`Set a time for: ${task.name}`; const input=document.createElement('input'); input.type='number'; input.min='1'; input.max=String(MAX_TASK_MINUTES); const start=document.createElement('button'); start.textContent='Start Task'; start.onclick=()=>{const minutes=Number.parseInt(input.value,10);if(!Number.isFinite(minutes)||minutes<1||minutes>MAX_TASK_MINUTES){alert(`Enter a number from 1 to ${MAX_TASK_MINUTES}.`);return;}task.estimatedTimeMs=minutes*60000;showFocus(task);}; screen.append(heading,input,start); container.appendChild(screen); }

function showFocus(task){
    if (hasHardStop() && Date.now() >= hardStopAtMs) { handleHardStop(); return; }
    startHardStopWatch();
    ensureTask(task); hideStaticScreens(); hide(el('startOverBtn')); show(el('stopWorkingBtn')); const container=clearDynamic(); const screen=document.createElement('div'); screen.id='focusScreen'; if(task.lastChanged===null) startTaskClock(task);
    const heading=document.createElement('h2'); heading.textContent=`Current Task: ${task.name}`; const timer=document.createElement('p'); timer.id='timer'; timer.style.fontSize='24px'; timer.style.fontWeight='bold';
    function renderTimer(){checkpointTask(task);const remaining=task.estimatedTimeMs-task.actualTimeMs;timer.style.color=remaining>=0?'green':'red';timer.textContent=remaining>=0?`${formatDuration(remaining)} remaining`:`${formatDuration(remaining)} overdue`;saveLocal('focus');}
    const done=document.createElement('button'); done.textContent='Done, Next!'; done.onclick=()=>{done.disabled=true;clearInterval(timerInterval);completeTask(task);activeTaskId=firstIncompleteTask()?.id||null;save('dashboard');beginWork();};
    const blocked=document.createElement('button'); blocked.textContent='Blocked'; blocked.onclick=()=>{clearInterval(timerInterval);pauseTaskClock(task);showBlockedFlow(task);};
    const add=document.createElement('button'); add.textContent='Add New Task'; add.onclick=()=>{clearInterval(timerInterval);checkpointTask(task);showAddTask(task);};
    screen.append(heading,timer,done,blocked,add); container.appendChild(screen); renderTimer(); clearInterval(timerInterval); timerInterval=setInterval(renderTimer,1000); save('focus');
}

function showSessionEnded() {
    clearInterval(timerInterval);
    clearInterval(hardStopInterval);
    hardStopInterval = null;
    hideStaticScreens();
    hide(el('stopWorkingBtn'));
    show(el('startOverBtn'));

    const container = clearDynamic();
    const screen = document.createElement('div');
    screen.id = 'sessionEndedScreen';

    const heading = document.createElement('h2');
    heading.textContent = 'Session Ended';

    const message = document.createElement('p');
    message.textContent = 'Your available time is up. The current task was saved without being marked complete.';

    const listButton = document.createElement('button');
    listButton.textContent = 'View Saved Task List';
    listButton.onclick = showDashboard;

    const resumeButton = document.createElement('button');
    resumeButton.textContent = 'Start Another Session';
    resumeButton.onclick = () => {
        hardStopHandled = false;
        sessionStartedAtMs = 0;
        hardStopAtMs = 0;
        totalAvailableTimeMs = 0;
        saveLocal('time-constraint');
        showTimeConstraint();
    };

    screen.append(heading, message, listButton, resumeButton);
    container.appendChild(screen);
    saveLocal('session-ended');
}

function showBlockedFlow(blockedTask){
    hideStaticScreens(); hide(el('stopWorkingBtn')); const container=clearDynamic(); const screen=document.createElement('div'); screen.id='blockedTaskScreen';
    const heading=document.createElement('h2'); heading.textContent=`What is blocking “${blockedTask.name}”?`; const input=document.createElement('input'); input.placeholder='Blocking task';
    const confirm=document.createElement('button'); confirm.textContent='Add Blocker and Requeue Both'; confirm.onclick=()=>{const name=input.value.trim();if(!name){alert('Enter the blocking task.');return;}const blocker=createTask(name);const blockedIndex=sortedTasks.findIndex(task=>task.id===blockedTask.id);if(blockedIndex>=0)sortedTasks.splice(blockedIndex,1);blockedTask.status='blocked';blockedTask.blockedByTaskId=blocker.id;blockedTask.lastChanged=null;sortedTasks.push(blocker,blockedTask);activeTaskId=firstIncompleteTask()?.id||null;save('dashboard');showDashboard();};
    const cancel=document.createElement('button'); cancel.textContent='Cancel and Continue Working'; cancel.onclick=()=>showFocus(blockedTask);
    screen.append(heading,input,confirm,cancel); container.appendChild(screen); saveLocal('focus');
}

function showAddTask(activeTask){
    hideStaticScreens(); const container=clearDynamic(); const screen=document.createElement('div'); screen.id='addTaskPage';
    const heading=document.createElement('h2'); heading.textContent='Add a Task'; const input=document.createElement('input'); input.placeholder='Task name';
    const choose=document.createElement('button'); choose.textContent='Choose Priority'; choose.onclick=()=>{const name=input.value.trim();if(!name){alert('Enter a task name.');return;}showTaskPlacement(createTask(name),activeTask);};
    const cancel=document.createElement('button'); cancel.textContent='Cancel'; cancel.onclick=()=>showFocus(activeTask); screen.append(heading,input,choose,cancel); container.appendChild(screen);
}
function showTaskPlacement(newTask,activeTask){
    const openTasks=incompleteTasks(); hideStaticScreens(); const container=clearDynamic(); const screen=document.createElement('div'); screen.id='taskPlacementScreen'; const heading=document.createElement('h2'); heading.textContent=`Where should “${newTask.name}” go?`; screen.appendChild(heading); const choices=document.createElement('div'); const activeIndex=sortedTasks.findIndex(task=>task.id===activeTask.id);
    function addChoice(label,insertIndex){const button=document.createElement('button');button.textContent=label;button.style.display='block';button.onclick=()=>{sortedTasks.splice(insertIndex,0,newTask);save('focus');showFocus(activeTask);};choices.appendChild(button);}
    addChoice('Do this next',Math.max(0,activeIndex+1)); openTasks.filter(task=>task.id!==activeTask.id).forEach(task=>{const index=sortedTasks.findIndex(item=>item.id===task.id);addChoice(`After “${task.name}”`,index+1);}); addChoice('Put it at the end',sortedTasks.length);
    const cancel=document.createElement('button');cancel.textContent='Cancel';cancel.onclick=()=>showFocus(activeTask);screen.append(choices,cancel);container.appendChild(screen);
}

function stopWorking(){clearInterval(timerInterval);const task=currentTask();if(task)pauseTaskClock(task);hide(el('stopWorkingBtn'));showStopChecklist();}
function showStopChecklist(){
    hideStaticScreens(); const container=clearDynamic(); const screen=document.createElement('div'); screen.id='stopChecklistScreen';
    const heading=document.createElement('h2'); heading.textContent='Did you finish any of these tasks?'; const note=document.createElement('p'); note.textContent='Check any tasks you completed, then end this work session.'; screen.append(heading,note);
    const checklist=document.createElement('div'); const checkboxes=[]; incompleteTasks().forEach(task=>{const label=document.createElement('label');label.style.display='block';const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.style.width='auto';checkbox.style.display='inline-block';checkbox.style.marginRight='8px';label.append(checkbox,document.createTextNode(task.name));checklist.appendChild(label);checkboxes.push({checkbox,task});});
    const finish=document.createElement('button'); finish.textContent='End Work Session'; finish.onclick=()=>{const now=Date.now();checkboxes.forEach(({checkbox,task})=>{if(checkbox.checked)completeTask(task,now);});activeTaskId=firstIncompleteTask()?.id||null;save('dashboard');if(firstIncompleteTask())showDashboard();else showCompletion();};
    const resume=document.createElement('button');resume.textContent='Keep Working';resume.onclick=()=>{const task=currentTask();if(task)showFocus(task);else showDashboard();};screen.append(checklist,finish,resume);container.appendChild(screen);saveLocal('stop-checklist');
}

function showCompletion(){clearInterval(timerInterval);hideStaticScreens();hide(el('stopWorkingBtn'));show(el('startOverBtn'));const container=clearDynamic();const screen=document.createElement('div');screen.id='completionScreen';const heading=document.createElement('h2');heading.textContent='All Done!';const varianceMs=sortedTasks.filter(task=>ensureTask(task).completed).reduce((sum,task)=>sum+task.estimatedTimeMs-task.actualTimeMs,0);const remaining=document.createElement('p');remaining.textContent=`Time Remaining: ${varianceMs<0?'-':''}${formatDuration(varianceMs,true)}`;remaining.style.color=varianceMs>=0?'green':'red';const title=document.createElement('h3');title.textContent='How Each Task Went:';const list=document.createElement('ul');sortedTasks.filter(task=>task.completed).forEach(task=>{const item=document.createElement('li');const actualMin=Math.round(task.actualTimeMs/60000);const estimateMin=Math.round(task.estimatedTimeMs/60000);const difference=estimateMin-actualMin;const comparison=difference>0?`${difference} minute${difference===1?'':'s'} ahead of schedule`:difference<0?`${Math.abs(difference)} minute${Math.abs(difference)===1?'':'s'} behind schedule`:'right on schedule';item.textContent=`${task.name} — finished in ${actualMin} minute${actualMin===1?'':'s'}, ${comparison}`;list.appendChild(item);});screen.append(heading,remaining,title,list);container.appendChild(screen);save('completion');}

async function resumeExistingList(){hideStaticScreens();const container=clearDynamic();container.textContent='Loading saved tasks…';try{await fetch(`${API_BASE_URL}/api/users/${encodeURIComponent(userId)}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:'{}'});await fetch(`${API_BASE_URL}/api/session/${encodeURIComponent(sessionId)}/tasks`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId,tasks:[],totalAvailableTimeMs:0,endConstraint:''})});const response=await fetch(`${API_BASE_URL}/api/users/${encodeURIComponent(userId)}/tasks/import`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId})});if(!response.ok)throw new Error(`Resume failed (${response.status})`);const data=await response.json();sortedTasks=(data.tasks||[]).map(row=>createTask(row.name,{id:row.id,estimatedTimeMs:row.estimated_ms,actualTimeMs:row.elapsed_ms,completed:false,status:row.status,created:row.created,started:row.started,lastChanged:null,blockedByTaskId:row.blocked_by_task_id}));activeTaskId=firstIncompleteTask()?.id||null;if(!sortedTasks.length){alert('No unfinished saved tasks were found.');showWorkChoice();return;}showDashboard();}catch(error){console.error(error);alert('The saved task list could not be loaded.');showWorkChoice();}}

function parseCsv(text){if(globalThis.Papa?.parse){try{const result=Papa.parse(text,{skipEmptyLines:true});if(!result.errors.length)return result.data;}catch(error){console.warn('CSV helper failed; using basic parser:',error);}}return text.split(/\r?\n/).filter(Boolean).map(line=>line.split(',').map(cell=>cell.trim()));}
function importFile(file){const reader=new FileReader();reader.onload=event=>{const text=String(event.target.result||'');const rows=parseCsv(text);const headers=(rows[0]||[]).map(value=>String(value).trim().toLowerCase());const nameIndex=headers.findIndex(value=>['task name','task','name','title','reminder'].includes(value));const idIndex=headers.findIndex(value=>['task id','id'].includes(value));const estimateIndex=headers.findIndex(value=>value.includes('estimated'));const actualIndex=headers.findIndex(value=>value.includes('actual'));const completedIndex=headers.findIndex(value=>['completed','done','status'].includes(value));const structured=nameIndex>=0;if(structured){sortedTasks=rows.slice(1).map(row=>createTask(row[nameIndex],{id:idIndex>=0?row[idIndex]:undefined,estimatedTimeMs:estimateIndex>=0?Number(row[estimateIndex]||0)*60000:0,actualTimeMs:actualIndex>=0?Number(row[actualIndex]||0)*60000:0,completed:completedIndex>=0&&['true','yes','1','done','completed'].includes(String(row[completedIndex]).toLowerCase())})).filter(task=>task.name);}else{sortedTasks=parsePlainTaskText(text).map(name=>createTask(name));}if(!sortedTasks.length){alert('No tasks were found in that file.');return;}hide(el('taskInput'));el('csvUpload').value='';activeTaskId=firstIncompleteTask()?.id||null;if(structured&&idIndex>=0)showDashboard();else showTimingGateway();};reader.onerror=()=>alert('That file could not be read.');reader.readAsText(file);}
function csvEscape(value){const text=String(value??'');return /[",\n]/.test(text)?`"${text.replace(/"/g,'""')}"`:text;}
function exportCsv(){const rows=[['Task Name','Estimated Time (Min)','Actual Time (Min)','Completed','Task ID']];sortedTasks.forEach(task=>rows.push([task.name,Math.round(task.estimatedTimeMs/60000),Math.round(task.actualTimeMs/60000),task.completed,task.id]));const blob=new Blob([rows.map(row=>row.map(csvEscape).join(',')).join('\n')],{type:'text/csv'});const link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download=`tasks_${new Date().toISOString().slice(0,16).replace(/[:T]/g,'-')}.csv`;link.click();URL.revokeObjectURL(link.href);}

function resetAll() {
    clearInterval(timerInterval);
    sortRunId++;
    localStorage.removeItem(LOCAL_STATE_KEY);
    localStorage.removeItem('taskSorterSessionId');
    sessionId = createId('session');
    localStorage.setItem('taskSorterSessionId', sessionId);
    sortedTasks = [];
    activeTaskId = null;
    clearSessionTiming();
    endConstraint = '';
    currentSortNames = [];
    showModeSelect();
}

function restartCurrentStep() {
    clearInterval(timerInterval);

    if (!el('timeConstraintInput')?.classList.contains('hidden')) {
        el('availableTime').value = '';
        el('endConstraint').value = '';
        return;
    }

    if (!el('taskInput')?.classList.contains('hidden')) {
        el('tasks').value = '';
        el('skipSortCheckbox').checked = false;
        updateCapacityMessage();
        return;
    }

    if (!el('taskCompare')?.classList.contains('hidden')) {
        sortRunId++;
        sortedTasks = [];
        activeTaskId = null;
        hide(el('taskCompare'));
        el('tasks').value = currentSortNames.join('\n');
        showTaskInput();
        return;
    }

    if (el('timingGatewayScreen')) {
        showTimingGateway();
        return;
    }

    if (el('timingEntryScreen')) {
        incompleteTasks().forEach(task => { task.estimatedTimeMs = 0; });
        showSequentialTiming(0);
    }
}

function showStartOverPrompt() {
    if (el('startOverModal')) return;

    const overlay = document.createElement('div');
    overlay.id = 'startOverModal';
    Object.assign(overlay.style, {
        position: 'fixed', inset: '0', backgroundColor: 'rgba(0,0,0,0.4)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: '1000'
    });

    const box = document.createElement('div');
    Object.assign(box.style, {
        backgroundColor: '#fff', padding: '20px', borderRadius: '8px',
        maxWidth: '320px', width: '85%', textAlign: 'center'
    });

    const message = document.createElement('p');
    message.textContent = 'What would you like to do?';
    message.style.fontWeight = 'bold';

    function modalButton(label, action, backgroundColor) {
        const button = document.createElement('button');
        button.textContent = label;
        Object.assign(button.style, { display: 'block', width: '100%', margin: '8px 0' });
        if (backgroundColor) button.style.backgroundColor = backgroundColor;
        button.onclick = () => { overlay.remove(); action(); };
        return button;
    }

    box.append(
        message,
        modalButton('Restart This Step', restartCurrentStep),
        modalButton('Restart From the Beginning', resetAll),
        modalButton('Cancel', () => {}, '#eceff1')
    );
    overlay.appendChild(box);
    document.body.appendChild(overlay);
}

function bindEvents(){
    el('workBtn').onclick=showWorkChoice;
    el('createNewListBtn').onclick=showTimeConstraint;
    el('resumeExistingListBtn').onclick=resumeExistingList;
    el('timeConstraintNextBtn').onclick=()=>{
        const minutes=Number.parseInt(el('availableTime').value,10);
        if(!Number.isFinite(minutes)||minutes<1){alert('Enter the number of minutes you have available.');return;}
        beginTimedSession(minutes * 60000);
        endConstraint=el('endConstraint').value.trim();
        saveLocal('input');
        showTaskInput();
    };
    el('tasks').addEventListener('input',updateCapacityMessage);
    el('startSort').onclick=startSorting;
    el('csvUpload').onchange=event=>{const file=event.target.files?.[0];if(file)importFile(file);};
    el('stopWorkingBtn').onclick=stopWorking;
    el('startOverBtn').onclick=showStartOverPrompt;
}

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
