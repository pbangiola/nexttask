/*config
this file contains functions for the browser level script to synchronize with the backend
*/

async function fetchExistingQueue() {
    try {
        //this is wrong. it should pull the user's task list, not the session queue. the session queue is a temporary thing that is not persisted.
        const res = await fetch(`/api/session/${sessionId}/queue`);
        if (res.ok) {
            const data = await res.json();
            return data.queue || [];
        }
    } catch (e) {
        console.warn("Failed to load existing task list from backend:", e);
    }
    return [];
}

/* this is not what this should be. this method should either append or prepend the current sortedtasks to the tasks table
// Full replace: pushes the current pending (not-yet-completed) task list to the
// backend queue, including each task's elapsed time so far. Called whenever the
// pending set changes structurally (list finalized, task added).
async function syncPendingQueueToBackend() {
    const pending = sortedTasks.slice(currentTaskIndex).map(task => ({
        name: task.name,
        estimatedTime: task.estimatedTime || 0,
        elapsedMs: task.actualTimeMs || 0
    }));

    try {
        await fetch(`/api/session/${sessionId}/queue`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tasks: pending })
        });
    } catch (e) {
        console.warn("Failed to sync pending queue to backend:", e);
    }
}
*/

/* This has been revised. There is no pending queue, and we don't delete tasks. need to replace with a "mark complete" task"
// Removes a single task from the backend's pending queue. Called any time a
// task is completed, so the queue never has to be reconciled in one big batch.
async function removeTaskFromQueue(taskName) {
    try {
        await fetch(`/api/session/${sessionId}/queue/remove`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ taskName })
        });
    } catch (e) {
        console.warn("Failed to remove task from server queue:", e);
    }
}
*/

//this method is ok but it shouldn't delete the session from the backend, just end the backend session. deleting the frontend session and cache makes sense.
async function clearSession() {
    try {
        await fetch(`/api/session/${sessionId}`, { method: 'DELETE' });
    } catch (e) {
        console.error("Failed to delete session on server:", e);
    }
    localStorage.removeItem('taskSorterSessionId');
    localStorage.removeItem('taskSorterSession_fallback');
}

//this looks right, but it's the wrong variables.
async function logTaskCompletionToBackend(task) {
    try {
        await fetch(`/api/session/${sessionId}/tasks/completed`, {
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
        console.warn("Failed to push completed task log to backend:", e);
    }
}
