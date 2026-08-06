// --- Workflow Bootstrap: chatgpt-2 timing model ---
(async function loadWorkflowFromBaseline() {
    const marker = '// --- App Initialization & Event Handlers ---';

    function replaceSection(source, startMarker, endMarker, replacement, label) {
        const start = source.indexOf(startMarker);
        const end = source.indexOf(endMarker, start);
        if (start === -1 || end === -1) {
            throw new Error(`Unable to apply workflow patch: ${label}`);
        }
        return source.slice(0, start) + replacement + source.slice(end);
    }

    const timingHelpers = `
// --- Millisecond Task Timing Model ---
function normalizeTask(task) {
    if (!task || typeof task !== 'object') return task;
    ensureTaskId(task);

    if (typeof task.completed !== 'boolean') {
        task.completed = task.status === 'completed' || Boolean(task.timestamps?.completed);
    }

    if (!Number.isFinite(task.estimatedTimeMs)) {
        task.estimatedTimeMs = Math.max(0, Number(task.estimatedTime || 0) * 60000);
    }

    task.actualTimeMs = Math.max(0, Number(task.actualTimeMs || 0));

    if (!task.timestamps) task.timestamps = {};
    task.created = Number(task.created || task.timestamps.created || Date.now());
    task.started = task.started ?? task.timestamps.started ?? null;
    task.completedTime = task.completedTime ?? task.timestamps.completed ?? null;
    task.lastChanged = task.lastChanged ?? null;

    task.estimatedTime = Math.round(task.estimatedTimeMs / 60000);
    task.status = task.completed ? 'completed' : (task.status || 'pending');
    task.timestamps.created = task.created;
    task.timestamps.started = task.started;
    task.timestamps.completed = task.completedTime;

    return task;
}

function normalizeAllTasks() {
    sortedTasks.forEach(normalizeTask);
}

function findFirstIncompleteTaskIndex() {
    normalizeAllTasks();
    return sortedTasks.findIndex(task => !task.completed);
}

function selectFirstIncompleteTask() {
    const index = findFirstIncompleteTaskIndex();
    currentTaskIndex = index === -1 ? sortedTasks.length : index;
    const task = sortedTasks[currentTaskIndex] || null;
    activeTaskId = task?.id || null;
    return task;
}

function checkpointTaskTiming(task, now = Date.now()) {
    normalizeTask(task);
    if (task.lastChanged !== null) {
        task.actualTimeMs += Math.max(0, now - task.lastChanged);
        task.lastChanged = now;
    }
    return task.actualTimeMs;
}

function beginTaskTiming(task, now = Date.now()) {
    normalizeTask(task);
    if (task.started === null) task.started = now;
    task.lastChanged = now;
    task.status = 'active';
    task.timestamps.started = task.started;
    return task;
}

function pauseTaskTiming(task, now = Date.now()) {
    checkpointTaskTiming(task, now);
    task.lastChanged = null;
    if (!task.completed) task.status = 'pending';
    return task;
}

function completeTaskTiming(task, now = Date.now()) {
    checkpointTaskTiming(task, now);
    task.lastChanged = null;
    task.completed = true;
    task.completedTime = now;
    task.status = 'completed';
    task.timestamps.completed = now;
    return task;
}

function formatTimerDuration(durationMs) {
    const totalSeconds = Math.floor(Math.abs(durationMs) / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const mmss = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    return hours > 0 ? `${hours}:${mmss}` : mmss;
}
`;

    const deadlineFunction = `// Deadline Setup
function startDeadlineSetting() {
    document.getElementById('stopWorkingBtn').classList.remove('hidden');
    hideStartOverBtn();

    const nextTask = selectFirstIncompleteTask();
    if (!nextTask) {
        displaySpareTime();
        return;
    }

    normalizeTask(nextTask);

    if (nextTask.estimatedTimeMs > 0) {
        beginTaskTiming(nextTask);
        startFocusScreen();
        return;
    }

    const container = document.getElementById('dynamicContainer');
    container.innerHTML = '';

    const deadlinePage = document.createElement('div');
    deadlinePage.id = 'deadlinePage';

    const taskName = document.createElement('h2');
    taskName.append('Set a deadline for: ');
    const strong = document.createElement('strong');
    strong.textContent = nextTask.name;
    taskName.appendChild(strong);
    deadlinePage.appendChild(taskName);

    const input = document.createElement('input');
    input.type = 'number';
    input.id = 'taskTime';
    input.placeholder = `Enter minutes (1-${MAX_TASK_MINUTES})`;
    deadlinePage.appendChild(input);

    const startButton = document.createElement('button');
    startButton.textContent = 'Start Task';
    startButton.addEventListener('click', () => {
        const minutes = Number.parseInt(input.value, 10);
        if (minutes < 1 || minutes > MAX_TASK_MINUTES) {
            alert(`Please pick a number between 1 and ${MAX_TASK_MINUTES} minutes.`);
            return;
        }

        nextTask.estimatedTimeMs = minutes * 60000;
        nextTask.estimatedTime = minutes;
        beginTaskTiming(nextTask);
        saveSession();
        startFocusScreen();
    });
    deadlinePage.appendChild(startButton);

    container.appendChild(deadlinePage);
    saveSession();
}

`;

    const focusFunction = `// Live Execution Focus Panel
function startFocusScreen() {
    document.getElementById('stopWorkingBtn').classList.remove('hidden');

    const currentTask = selectFirstIncompleteTask();
    if (!currentTask) {
        displaySpareTime();
        return;
    }

    normalizeTask(currentTask);
    if (currentTask.lastChanged === null) beginTaskTiming(currentTask);

    const container = document.getElementById('dynamicContainer');
    container.innerHTML = '';

    const focusScreen = document.createElement('div');
    focusScreen.id = 'focusScreen';

    const taskName = document.createElement('h2');
    taskName.append('Current Task: ');
    const strong = document.createElement('strong');
    strong.textContent = currentTask.name;
    taskName.appendChild(strong);
    focusScreen.appendChild(taskName);

    const timerDisplay = document.createElement('p');
    timerDisplay.id = 'timer';
    timerDisplay.style.fontSize = '24px';
    timerDisplay.style.fontWeight = 'bold';
    focusScreen.appendChild(timerDisplay);

    function renderTimer() {
        checkpointTaskTiming(currentTask);
        const timeRemainingMs = currentTask.estimatedTimeMs - currentTask.actualTimeMs;
        timerDisplay.style.color = timeRemainingMs >= 0 ? 'green' : 'red';
        timerDisplay.textContent = timeRemainingMs >= 0
            ? `${formatTimerDuration(timeRemainingMs)} remaining`
            : `${formatTimerDuration(timeRemainingMs)} overdue`;
    }

    function finalizeCurrentTaskAndAdvance(button) {
        if (button) button.disabled = true;
        if (timerInterval) clearInterval(timerInterval);

        const now = Date.now();
        completeTaskTiming(currentTask, now);
        spareTime += Math.round((currentTask.estimatedTimeMs - currentTask.actualTimeMs) / 1000);

        selectFirstIncompleteTask();
        saveSession();
        logTaskCompletionToBackend(currentTask);

        if (currentTaskIndex < sortedTasks.length) {
            startDeadlineSetting();
        } else {
            document.getElementById('stopWorkingBtn').classList.add('hidden');
            displaySpareTime();
        }
    }

    renderTimer();
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(renderTimer, 1000);

    const doneNext = document.createElement('button');
    doneNext.textContent = 'Done, Next!';
    doneNext.addEventListener('click', () => finalizeCurrentTaskAndAdvance(doneNext));
    focusScreen.appendChild(doneNext);

    const addTask = document.createElement('button');
    addTask.textContent = 'Add New Task';
    addTask.addEventListener('click', () => {
        if (timerInterval) clearInterval(timerInterval);
        checkpointTaskTiming(currentTask);
        saveSession();
        startAddTask();
    });
    focusScreen.appendChild(addTask);

    container.appendChild(focusScreen);
    saveSession();
}

`;

    const stopFunction = `// Stop Working routine & checklist verification
async function handleStopWorking() {
    if (timerInterval) clearInterval(timerInterval);

    const activeTask = sortedTasks.find(task => {
        normalizeTask(task);
        return !task.completed && task.lastChanged !== null;
    });

    if (activeTask) {
        pauseTaskTiming(activeTask);
        setActiveTask(activeTask);
    }

    document.getElementById('stopWorkingBtn').classList.add('hidden');

    saveSession();
    syncPendingQueueToBackend();

    const uncompleted = sortedTasks.filter(task => {
        normalizeTask(task);
        return !task.completed;
    });

    if (uncompleted.length > 0) {
        renderUncompletedChecklistScreen(uncompleted);
    } else {
        finalizeStopWorkingSession();
    }
}

`;

    try {
        const response = await fetch('script.original.js', { cache: 'no-store' });
        if (!response.ok) throw new Error(`Unable to load workflow baseline (${response.status})`);

        const baselineSource = await response.text();
        const workflowStart = baselineSource.indexOf(marker);
        if (workflowStart === -1) throw new Error('Workflow boundary marker was not found');

        let workflowSource = timingHelpers + '\n' + baselineSource.slice(workflowStart);

        workflowSource = replaceSection(
            workflowSource,
            '// Deadline Setup',
            '// Live Execution Focus Panel',
            deadlineFunction,
            'deadline setup'
        );

        workflowSource = replaceSection(
            workflowSource,
            '// Live Execution Focus Panel',
            '// Stop Working routine & checklist verification',
            focusFunction,
            'focus timer'
        );

        workflowSource = replaceSection(
            workflowSource,
            '// Stop Working routine & checklist verification',
            'function renderUncompletedChecklistScreen',
            stopFunction,
            'stop-working pause'
        );

        workflowSource = workflowSource.replace(
            '    loadSession();',
            `    const localSaved = localStorage.getItem('taskSorterSession_fallback');
    if (localSaved) {
        try {
            const localState = JSON.parse(localSaved);
            sortedTasks = localState.sortedTasks || [];
            normalizeAllTasks();
            activeTaskId = localState.activeTaskId || null;
            totalAvailableTime = localState.totalAvailableTime || 0;
            endConstraint = localState.endConstraint || '';
        } catch (error) {
            console.warn('Local session restore failed:', error);
        }
    }`
        );

        workflowSource = workflowSource.replace(
            'function displaySortedTasks() {',
            `function displaySortedTasks() {
    normalizeAllTasks();
    selectFirstIncompleteTask();`
        );

        workflowSource = workflowSource.replace(
            '                task.timestamps.completed = nowMs;\n                if (!task.timestamps.started) task.timestamps.started = nowMs;',
            `                completeTaskTiming(task, nowMs);
                if (!task.started) task.started = nowMs;`
        );

        (0, eval)(`${workflowSource}\n//# sourceURL=task-sorter-workflow-chatgpt-2.js`);
    } catch (error) {
        console.error('Task Sorter workflow failed to initialize:', error);
        const container = document.getElementById('dynamicContainer');
        if (container) {
            container.innerHTML = '';
            const message = document.createElement('p');
            message.textContent = 'Task Sorter could not start. Refresh the page and try again.';
            message.style.color = '#b71c1c';
            message.style.fontWeight = 'bold';
            container.appendChild(message);
        }
    }
})();
