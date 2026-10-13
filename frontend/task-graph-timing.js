'use strict';
// Local browser time remains the display/canonical elapsed policy (D4 pending).
// Starts/stops reject on failure; the loaded client journals their stable IDs.
window.TaskGraphTiming = (() => {
    const active = new Map();
    const pending = new Map();
    function enqueue(taskId, operation) {
        const previous = pending.get(taskId) || Promise.resolve();
        const next = previous.then(operation);
        pending.set(taskId, next);
        next.finally(() => { if (pending.get(taskId) === next) pending.delete(taskId); }).catch(() => {});
        return next;
    }
    function start(taskId, startedAt = Date.now()) {
        const sessionId = window.activeWorkSessionId;
        if (!sessionId || !window.TaskGraph) return Promise.reject(new Error('Prepare durable work before starting Focus.'));
        return enqueue(taskId, async () => {
            if (active.has(taskId)) return;
            const interval = await window.TaskGraph.startWork(taskId, sessionId, startedAt);
            if (interval.ended_at == null) active.set(taskId, interval.id);
        });
    }
    function stop(taskId, endedAt = Date.now()) {
        return enqueue(taskId, async () => {
            const id = active.get(taskId) || window.TaskGraph?.run?.(taskId)?.id;
            if (!id) return;
            await window.TaskGraph.stopWork(id, endedAt);
            active.delete(taskId);
        });
    }
    async function restore(sessionId) {
        const intervals = await window.TaskGraph.openIntervals(sessionId);
        active.clear();
        for (const interval of intervals) active.set(interval.task_id, interval.id);
    }
    function activeIntervalId(taskId) { return active.get(taskId) || window.TaskGraph?.run?.(taskId)?.id || null; }
    function forget(taskId) { active.delete(taskId); }
    function clear() { active.clear(); pending.clear(); }
    return { start, stop, restore, activeIntervalId, forget, clear };
})();
