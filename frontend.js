// --- Persistence Layer, Task Queue, & User Analytics Sync ---
function apiUrl(path) {
    return `${API_BASE_URL}${path}`;
}

async function saveSession() {
    const sessionState = {
        sortedTasks,
        currentTaskIndex,
        deadline,
        spareTime,
        taskStartTimestamp,
        pausedSecondsRemaining,
        totalAvailableTime,
        endConstraint,
        sessionStartTimestamp,
        currentStepStartTimestamp,
        activeView: getActiveViewContext()
    };

    localStorage.setItem('taskSorterSession_fallback', JSON.stringify(sessionState));

    try {
        await fetch(apiUrl(`/api/session/${sessionId}`), {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(sessionState)
        });
    } catch (e) {
        console.warn('Backend sync failed, state preserved in browser cache:', e);
    }
}

async function loadSession() {
    let state = null;

    try {
        const res = await fetch(apiUrl(`/api/session/${sessionId}`));
        if (res.ok) state = await res.json();
    } catch (e) {
        console.warn('Could not reach backend, checking browser cache...', e);
    }

    if (!state) {
        const saved = localStorage.getItem('taskSorterSession_fallback');
        if (saved) {
            try { state = JSON.parse(saved); } catch (e) {}
        }
    }

    if (!state) return;

    try {
        sortedTasks = state.sortedTasks || [];
        currentTaskIndex = state.currentTaskIndex || 0;
        deadline = state.deadline || 0;
        spareTime = state.spareTime || 0;
        taskStartTimestamp = state.taskStartTimestamp || 0;
        pausedSecondsRemaining = state.pausedSecondsRemaining || 0;
        totalAvailableTime = state.totalAvailableTime || 0;
        endConstraint = state.endConstraint || '';
        sessionStartTimestamp = state.sessionStartTimestamp || null;
        currentStepStartTimestamp = state.currentStepStartTimestamp || null;

        if (state.activeView && state.activeView !== 'mode-select') {
            document.getElementById('modeSelect')?.classList.add('hidden');
            document.getElementById('timeConstraintInput')?.classList.add('hidden');
            document.getElementById('taskInput')?.classList.add('hidden');
            routeToStoredView(state.activeView);
        }
    } catch (e) {
        console.error('Error restoring session state:', e);
    }
}

async function fetchExistingQueue() {
    try {
        const res = await fetch(apiUrl(`/api/session/${sessionId}/queue`));
        if (res.ok) {
            const data = await res.json();
            return data.queue || [];
        }
    } catch (e) {
        console.warn('Failed to load existing task list from backend:', e);
    }
    return [];
}

async function syncPendingQueueToBackend() {
    const pending = sortedTasks.slice(currentTaskIndex).map(task => ({
        name: task.name,
        estimatedTime: task.estimatedTime || 0,
        elapsedMs: task.actualTimeMs || 0
    }));

    try {
        await fetch(apiUrl(`/api/session/${sessionId}/queue`), {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tasks: pending })
        });
    } catch (e) {
        console.warn('Failed to sync pending queue to backend:', e);
    }
}

async function removeTaskFromQueue(taskName) {
    try {
        await fetch(apiUrl(`/api/session/${sessionId}/queue/remove`), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ taskName })
        });
    } catch (e) {
        console.warn('Failed to remove task from server queue:', e);
    }
}

async function clearSession() {
    try {
        await fetch(apiUrl(`/api/session/${sessionId}`), { method: 'DELETE' });
    } catch (e) {
        console.error('Failed to delete session on server:', e);
    }
    localStorage.removeItem('taskSorterSessionId');
    localStorage.removeItem('taskSorterSession_fallback');
}

async function logTaskCompletionToBackend(task) {
    try {
        await fetch(apiUrl(`/api/session/${sessionId}/tasks/completed`), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                taskName: task.name,
                estimatedMinutes: task.estimatedTime || 0,
                actualMinutes: Math.round((task.actualTimeMs || 0) / 60000),
                completedAt: task.timestamps?.completed || Date.now()
            })
        });
    } catch (e) {
        console.warn('Failed to push completed task log to backend:', e);
    }
}

function getActiveViewContext() {
    if (document.getElementById('focusScreen')) return 'focus';
    if (document.getElementById('deadlinePage')) return 'deadline';
    if (document.getElementById('addTaskPage')) return 'add-task';
    if (document.getElementById('completionScreen')) return 'completion';
    if (sortedTasks.length > 0 && document.getElementById('taskInput').classList.contains('hidden')) return 'dashboard';
    if (!document.getElementById('taskInput').classList.contains('hidden')) return 'input';
    if (!document.getElementById('timeConstraintInput').classList.contains('hidden')) return 'time-constraint';
    if (!document.getElementById('workChoiceStep').classList.contains('hidden')) return 'work-choice';
    if (!document.getElementById('modeSelect').classList.contains('hidden')) return 'mode-select';
    return 'input';
}

function routeToStoredView(view) {
    const nowSec = Math.floor(Date.now() / 1000);

    switch (view) {
        case 'work-choice':
            document.getElementById('workChoiceStep')?.classList.remove('hidden');
            showStartOverBtn();
            break;
        case 'time-constraint':
            document.getElementById('timeConstraintInput')?.classList.remove('hidden');
            showStartOverBtn();
            break;
        case 'input':
            document.getElementById('taskInput')?.classList.remove('hidden');
            checkTaskInputCapacity();
            showStartOverBtn();
            break;
        case 'focus':
            hideStartOverBtn();
            if (deadline > nowSec || pausedSecondsRemaining > 0) startFocusScreen();
            else displaySortedTasks();
            break;
        case 'deadline':
            hideStartOverBtn();
            startDeadlineSetting();
            break;
        case 'add-task':
            hideStartOverBtn();
            startAddTask();
            break;
        case 'completion':
            hideStartOverBtn();
            displaySpareTime();
            break;
        case 'dashboard':
        default:
            hideStartOverBtn();
            displaySortedTasks();
            break;
    }
}
