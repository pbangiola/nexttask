// --- Persistence Layer, Canonical Tasks, & Migration Compatibility ---
function apiUrl(path) {
    return `${API_BASE_URL}${path}`;
}

function ensureTaskId(task) {
    if (task.id) return task.id;

    const createdAt = task.timestamps?.created || Date.now();
    const randomPart = typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2, 10);

    task.id = `task_${sessionId}_${createdAt}_${randomPart}`;
    return task.id;
}

function syncCurrentTaskIndexFromActiveId() {
    if (!activeTaskId) {
        const firstOpenIndex = sortedTasks.findIndex(task => task.status !== 'completed' && !task.timestamps?.completed);
        currentTaskIndex = firstOpenIndex === -1 ? sortedTasks.length : firstOpenIndex;
        activeTaskId = sortedTasks[currentTaskIndex]?.id || null;
        return;
    }

    const activeIndex = sortedTasks.findIndex(task => task.id === activeTaskId);
    if (activeIndex >= 0) {
        currentTaskIndex = activeIndex;
        return;
    }

    activeTaskId = null;
    syncCurrentTaskIndexFromActiveId();
}

function setActiveTask(taskOrId) {
    activeTaskId = typeof taskOrId === 'string' ? taskOrId : taskOrId?.id || null;
    syncCurrentTaskIndexFromActiveId();
}

function getActiveTask() {
    syncCurrentTaskIndexFromActiveId();
    return activeTaskId
        ? sortedTasks.find(task => task.id === activeTaskId) || null
        : null;
}

function advanceActiveTask() {
    const activeIndex = sortedTasks.findIndex(task => task.id === activeTaskId);
    const nextTask = sortedTasks.slice(Math.max(0, activeIndex + 1))
        .find(task => task.status !== 'completed' && !task.timestamps?.completed);
    activeTaskId = nextTask?.id || null;
    syncCurrentTaskIndexFromActiveId();
    return nextTask || null;
}

function canonicalRowToTask(row) {
    const completed = row.status === 'completed' || Boolean(row.completed_at);
    return {
        id: row.id,
        projectId: row.project_id || null,
        name: row.name,
        status: row.status || (completed ? 'completed' : 'pending'),
        estimatedTime: Math.round(Number(row.estimated_ms || 0) / 60000),
        actualTimeMs: Number(row.elapsed_ms || 0),
        blockedByTaskId: row.blocked_by_task_id || null,
        dueAt: row.due_at || null,
        timestamps: {
            created: row.created_at || Date.now(),
            started: row.started_at || null,
            lastStarted: row.started_at || null,
            completed: row.completed_at || null
        }
    };
}

function toCanonicalTask(task, sortOrder, status = task.status || 'pending') {
    const timestamps = task.timestamps || {};
    return {
        id: ensureTaskId(task),
        name: task.name,
        status,
        estimatedMs: Number(task.estimatedTime || 0) * 60000,
        elapsedMs: Number(task.actualTimeMs || 0),
        sortOrder,
        projectId: task.projectId || null,
        blockedByTaskId: task.blockedByTaskId || null,
        createdAt: timestamps.created || Date.now(),
        startedAt: timestamps.started || null,
        dueAt: task.dueAt || null,
        completedAt: timestamps.completed || null
    };
}

async function fetchCanonicalTasks() {
    try {
        const response = await fetch(apiUrl(`/api/session/${sessionId}/tasks`));
        if (!response.ok) return [];
        const data = await response.json();
        return Array.isArray(data.tasks) ? data.tasks : [];
    } catch (error) {
        console.warn('Canonical task read failed:', error);
        return [];
    }
}

async function saveCanonicalTask(task, sortOrder, status = task.status || 'pending') {
    const payload = toCanonicalTask(task, sortOrder, status);
    const response = await fetch(apiUrl(`/api/session/${sessionId}/tasks/${encodeURIComponent(payload.id)}`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    if (!response.ok) throw new Error(`Canonical task save failed (${response.status})`);
    return response.json();
}

async function saveSession() {
    sortedTasks.forEach(ensureTaskId);
    syncCurrentTaskIndexFromActiveId();

    const sessionState = {
        sortedTasks,
        activeTaskId,
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

    // Canonical tasks are now the preferred source of truth.
    const canonicalRows = await fetchCanonicalTasks();
    if (canonicalRows.length > 0) {
        sortedTasks = canonicalRows.map(canonicalRowToTask);
        const active = sortedTasks.find(task => task.status === 'active')
            || sortedTasks.find(task => task.status !== 'completed');
        activeTaskId = active?.id || null;
        syncCurrentTaskIndexFromActiveId();
    }

    try {
        const res = await fetch(apiUrl(`/api/session/${sessionId}`));
        if (res.ok) state = await res.json();
    } catch (e) {
        console.warn('Could not reach session endpoint, checking browser cache...', e);
    }

    if (!state) {
        const saved = localStorage.getItem('taskSorterSession_fallback');
        if (saved) {
            try { state = JSON.parse(saved); } catch (e) {}
        }
    }

    if (state) {
        try {
            if (sortedTasks.length === 0) {
                sortedTasks = state.sortedTasks || [];
                sortedTasks.forEach(ensureTaskId);
                activeTaskId = state.activeTaskId || sortedTasks[state.currentTaskIndex || 0]?.id || null;
                syncCurrentTaskIndexFromActiveId();
            }

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
}

async function fetchExistingQueue() {
    const canonicalRows = await fetchCanonicalTasks();
    if (canonicalRows.length > 0) {
        return canonicalRows
            .filter(row => row.status !== 'completed' && row.status !== 'cancelled')
            .map(row => ({
                id: row.id,
                task_name: row.name,
                estimated_minutes: Math.round(Number(row.estimated_ms || 0) / 60000),
                elapsed_ms: Number(row.elapsed_ms || 0),
                status: row.status,
                created_at: row.created_at
            }));
    }

    // Temporary fallback for sessions created before the canonical task model.
    try {
        const res = await fetch(apiUrl(`/api/session/${sessionId}/queue`));
        if (res.ok) {
            const data = await res.json();
            return data.queue || [];
        }
    } catch (e) {
        console.warn('Failed to load legacy task queue:', e);
    }
    return [];
}

async function syncPendingQueueToBackend() {
    sortedTasks.forEach(ensureTaskId);
    syncCurrentTaskIndexFromActiveId();

    const pendingTasks = sortedTasks.filter(task => task.status !== 'completed' && !task.timestamps?.completed);

    await saveSession();

    // Canonical writes are primary.
    try {
        await Promise.all(pendingTasks.map((task, index) => {
            const status = task.id === activeTaskId ? 'active' : (task.status === 'blocked' ? 'blocked' : 'pending');
            task.status = status;
            return saveCanonicalTask(task, index + 1, status);
        }));
    } catch (e) {
        console.warn('Failed to sync canonical tasks:', e);
    }

    // Legacy queue write remains temporarily for rollback compatibility.
    const pending = pendingTasks.map(task => ({
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
        console.warn('Failed to sync legacy pending queue:', e);
    }

    await saveSession();
}

async function removeTaskFromQueue(taskName) {
    try {
        await fetch(apiUrl(`/api/session/${sessionId}/queue/remove`), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ taskName })
        });
    } catch (e) {
        console.warn('Failed to remove task from legacy queue:', e);
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
    ensureTaskId(task);
    const completedAt = task.timestamps?.completed || Date.now();
    task.status = 'completed';

    try {
        await saveCanonicalTask(task, Math.max(1, sortedTasks.indexOf(task) + 1), 'completed');
        await fetch(apiUrl(`/api/session/${sessionId}/tasks/${encodeURIComponent(task.id)}/complete`), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ completedAt, elapsedMs: task.actualTimeMs || 0 })
        });
    } catch (e) {
        console.warn('Failed to mark canonical task complete:', e);
    }

    // Temporary legacy analytics write.
    try {
        await fetch(apiUrl(`/api/session/${sessionId}/tasks/completed`), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                taskName: task.name,
                estimatedMinutes: task.estimatedTime || 0,
                actualMinutes: Math.round((task.actualTimeMs || 0) / 60000),
                completedAt
            })
        });
    } catch (e) {
        console.warn('Failed to push legacy completed task log:', e);
    }

    if (activeTaskId === task.id) advanceActiveTask();
    await saveSession();
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
            if (getActiveTask() && (deadline > nowSec || pausedSecondsRemaining !== 0)) startFocusScreen();
            else displaySortedTasks();
            break;
        case 'deadline':
            hideStartOverBtn();
            if (getActiveTask()) startDeadlineSetting();
            else displaySpareTime();
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
