'use strict';
// Best-effort durable interval bridge. Local timestamps remain the live UI clock.
// The backend interval log is not yet authoritative until reconciliation is implemented.
window.TaskGraphTiming = (() => {
    const active = new Map();
    const pending = new Map();
    function enqueue(taskId, operation) {
        const previous = pending.get(taskId) || Promise.resolve();
        const next = previous.catch(() => {}).then(operation);
        pending.set(taskId, next);
        next.finally(() => { if (pending.get(taskId) === next) pending.delete(taskId); }).catch(() => {});
        return next;
    }
    function start(taskId, startedAt = Date.now()) {
        if (!window.activeWorkSessionId || !window.TaskGraph) return;
        return enqueue(taskId, async () => {
            if (active.has(taskId)) return;
            try {
                // The legacy UI saves new tasks asynchronously. Wait for their snapshot
                // before opening a durable interval (foreign key requires task row).
                if (typeof pendingTaskSnapshot !== 'undefined') await pendingTaskSnapshot;
                const interval = await window.TaskGraph.startWork(taskId, window.activeWorkSessionId, startedAt);
                active.set(taskId, interval.id);
            } catch (error) { console.warn('Work interval start failed:', error); }
        });
    }
    function stop(taskId, endedAt = Date.now()) {
        if (!window.TaskGraph) return;
        return enqueue(taskId, async () => {
            const id = active.get(taskId);
            if (!id) return;
            try {
                await window.TaskGraph.stopWork(id, endedAt);
                active.delete(taskId);
            } catch (error) { console.warn('Work interval stop failed:', error); }
        });
    }
    async function restore(sessionId) {
        if (!sessionId || !window.TaskGraph) return;
        try {
            const intervals=await window.TaskGraph.openIntervals(sessionId);
            for (const interval of intervals) active.set(interval.task_id, interval.id);
        } catch (error) { console.warn('Unable to recover active intervals:', error); }
    }
    function activeIntervalId(taskId) { return active.get(taskId) || null; }
    return {start, stop, restore, activeIntervalId};
})();
