// Canonical full-list persistence overrides.
// Loaded after frontend.js. Browser memory/localStorage remains authoritative;
// server writes are fire-and-forget snapshots.

function taskToServerPayload(task, position) {
    ensureTaskId(task);
    const completedTime = task.completedTime ?? task.timestamps?.completed ?? null;
    return {
        id: task.id,
        name: task.name,
        status: task.completed || completedTime ? 'completed' : (task.status || 'pending'),
        estimatedTimeMs: Number(task.estimatedTimeMs ?? (task.estimatedTime || 0) * 60000),
        actualTimeMs: Number(task.actualTimeMs || 0),
        position,
        projectId: task.projectId || null,
        blockedByTaskId: task.blockedByTaskId || null,
        created: Number(task.created ?? task.timestamps?.created ?? Date.now()),
        started: task.started ?? task.timestamps?.started ?? null,
        completedTime,
        lastChanged: task.lastChanged ?? null
    };
}

function serverRowToTask(row) {
    const isCompleted = row.status === 'completed' || Boolean(row.completed);
    return {
        id: row.id,
        name: row.name,
        status: row.status,
        completed: isCompleted,
        estimatedTimeMs: Number(row.estimated_ms || 0),
        estimatedTime: Math.round(Number(row.estimated_ms || 0) / 60000),
        actualTimeMs: Number(row.elapsed_ms || 0),
        projectId: row.project_id || null,
        blockedByTaskId: row.blocked_by_task_id || null,
        created: row.created,
        started: row.started,
        completedTime: row.completed,
        lastChanged: row.last_changed,
        timestamps: {
            created: row.created,
            started: row.started,
            completed: row.completed
        }
    };
}

async function fetchCanonicalTasks(incompleteOnly = false) {
    try {
        const suffix = incompleteOnly ? '?incomplete=1' : '';
        const response = await fetch(apiUrl(`/api/session/${sessionId}/tasks${suffix}`));
        if (!response.ok) return [];
        const data = await response.json();
        return Array.isArray(data.tasks) ? data.tasks : [];
    } catch (error) {
        console.warn('Canonical task read failed:', error);
        return [];
    }
}

async function fetchExistingQueue() {
    const rows = await fetchCanonicalTasks(true);
    return rows.map(row => ({
        id: row.id,
        task_name: row.name,
        estimated_minutes: Math.round(Number(row.estimated_ms || 0) / 60000),
        elapsed_ms: Number(row.elapsed_ms || 0),
        status: row.status,
        created_at: row.created,
        started_at: row.started,
        completed_at: row.completed,
        last_changed: row.last_changed
    }));
}

async function syncPendingQueueToBackend() {
    sortedTasks.forEach(ensureTaskId);

    const payload = {
        tasks: sortedTasks.map((task, index) => taskToServerPayload(task, index + 1)),
        totalAvailableTimeMs: Number(totalAvailableTime || 0) * 60000,
        endConstraint
    };

    try {
        const response = await fetch(apiUrl(`/api/session/${sessionId}/tasks`), {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!response.ok) throw new Error(`Task-list sync failed (${response.status})`);
    } catch (error) {
        console.warn('Server task-list backup failed; browser state is unchanged:', error);
    }
}

async function removeTaskFromQueue() {
    return undefined;
}

async function logTaskCompletionToBackend() {
    syncPendingQueueToBackend();
}
