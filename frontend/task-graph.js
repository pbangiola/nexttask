'use strict';

// One account-bound HTTP client and FIFO write-ahead journal. A response lost
// after commit is retried with the same request, session ID and interval ID.
window.TaskGraph = (() => {
    if (window.taskSorterMode === 'guest') return window.createGuestGraph();
    const owner = String(window.taskSorterAuth?.userId || '');
    const key = `taskSorterDurability_${owner}`;
    let state;
    try { state = JSON.parse(localStorage.getItem(key) || 'null'); } catch (_) {}
    state = state?.owner === owner && Array.isArray(state.actions) && state.runs
        ? state : { owner, sessionId: null, runs: {}, actions: [] };
    const waiters = new Map();
    let processing = null;
    let failure = null;
    let invalid = false;
    window.activeWorkSessionId = state.sessionId;

    function assertOwner() {
        if (invalid || !owner || window.taskSorterAuth?.userId !== owner) throw new Error('Account changed. Reload to continue.');
    }
    function persist() { assertOwner(); localStorage.setItem(key, JSON.stringify(state)); }
    function notify(message, failed = false) {
        window.dispatchEvent(new CustomEvent('durability-status', { detail: { message, failed, pending: state.actions.length } }));
    }
    async function request(path, method = 'GET', body) {
        assertOwner();
        const response = await fetch(`${API_BASE_URL}/api${path}`, {
            method, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        });
        assertOwner();
        const result = await response.json();
        if (!response.ok) {
            const error = new Error(result.detail || result.error || `Save failed (${response.status})`);
            error.status = response.status;
            throw error;
        }
        return result;
    }
    function apply(step, result) {
        if (step.path === '/work-sessions/prepare') {
            state.sessionId = result.workSession.status === 'open' ? result.workSession.id : null;
            window.activeWorkSessionId = state.sessionId;
            // Replacement atomically closed all old runs.
            state.runs = {};
        } else if (step.path === '/work-intervals') {
            const row = result.interval;
            if (row.ended_at == null) state.runs[row.task_id] = { id: row.id, startedAt: row.started_at };
            else delete state.runs[row.task_id];
        } else if (/\/work-intervals\/.*\/stop$/.test(step.path)) {
            for (const [taskId, run] of Object.entries(state.runs)) {
                if (run.id === result.interval.id) delete state.runs[taskId];
            }
        } else if (/\/work-sessions\/.*\/end$/.test(step.path) && result.workSession.id === state.sessionId) {
            state.sessionId = null;
            state.runs = {};
            window.activeWorkSessionId = null;
        }
    }
    async function drain() {
        assertOwner();
        if (processing) return processing;
        if (failure) throw failure;
        processing = (async () => {
            while (state.actions.length) {
                const action = state.actions[0];
                notify(`Saving ${action.label}…`);
                try {
                    while (action.index < action.steps.length) {
                        const step = action.steps[action.index];
                        // A start can acknowledge an existing same-session run.
                        // Resolve the stop against that acknowledgement before
                        // dispatch, then retain that exact path through retries.
                        if (step.runTaskId && !step.resolved) {
                            const run = state.runs[step.runTaskId];
                            if (run) step.path = `/work-intervals/${encodeURIComponent(run.id)}/stop`;
                            step.resolved = true;
                            persist();
                        }
                        const result = await request(step.path, step.method, step.body);
                        apply(step, result);
                        action.results.push(result);
                        action.index++;
                        persist();
                    }
                    state.actions.shift();
                    persist();
                    const waiter = waiters.get(action.id);
                    waiters.delete(action.id);
                    waiter?.ack?.(action.results);
                    waiter?.resolve(action.results);
                } catch (error) {
                    failure = error;
                    waiters.get(action.id)?.reject(error);
                    notify('Save pending. Retry before continuing.', true);
                    throw error;
                }
            }
            notify('Saved');
        })();
        try { return await processing; } finally {
            processing = null;
            // A caller resumed by the last acknowledgement may already have
            // appended its next action while this drain was settling.
            if(state.actions.length && !failure && !invalid) queueMicrotask(()=>drain().catch(()=>{}));
        }
    }
    function commit(label, steps, ack) {
        assertOwner();
        const action = { id: createId('action'), sessionId: state.sessionId, label, steps: JSON.parse(JSON.stringify(steps)), index: 0, results: [] };
        state.actions.push(action);
        persist();
        const result = new Promise((resolve, reject) => waiters.set(action.id, { resolve, reject, ack }));
        result.catch(() => {}); // Callers still receive rejection; no unhandled UI promise.
        drain().catch(() => {});
        return result;
    }
    function reserve(taskId, startedAt) {
        assertOwner();
        if (!state.runs[taskId]) {
            state.runs[taskId] = { id: createId('interval'), startedAt };
            persist();
        }
        return state.runs[taskId];
    }
    function adopt(sessionId, intervals) {
        state.sessionId = sessionId;
        window.activeWorkSessionId = sessionId;
        state.runs = Object.fromEntries(intervals.map(row => [row.task_id, { id: row.id, startedAt: row.started_at }]));
        persist();
    }
    async function validateRecovery() {
        if (!state.sessionId) return;
        const id = state.sessionId;
        let closed;
        try { closed = (await request(`/work-sessions/${encodeURIComponent(id)}`)).workSession.status !== 'open'; }
        catch (error) { if (error.status !== 404) throw error; closed = true; }
        if (!closed) return;
        // Confirmed server closure overrides stale local starts/snapshots. A new
        // replacement preparation retains its distinct retryable session ID.
        state.actions = state.actions.filter(action => action.sessionId !== id || action.label === 'work preparation');
        state.sessionId = null; state.runs = {}; window.activeWorkSessionId = null;
        persist();
        return true;
    }
    function canReturnToSavedWork() {
        const action = state.actions[0];
        return [400, 404].includes(failure?.status) && action?.label === 'work preparation'
            && action.steps[action.index]?.path === '/work-sessions/prepare';
    }
    async function returnToSavedWork() {
        if (!canReturnToSavedWork()) throw new Error('Retry the uncertain save before continuing.');
        const id = state.actions[0].steps[state.actions[0].index].body.id;
        let absent = false;
        try { await request(`/work-sessions/${encodeURIComponent(id)}`); }
        catch (error) { if (error.status !== 404) throw error; absent = true; }
        if (!absent) throw new Error('The prepared session exists. Retry its acknowledgement.');
        // Only discard definitively rejected, confirmed-uncreated preparation.
        // Canonical task rows already saved by its first step are retained.
        state.actions = []; failure = null;
        for (const waiter of waiters.values()) waiter.reject(new Error('Preparation cancelled; saved tasks retained.'));
        waiters.clear(); persist();
    }
    return {
        request, commit, reserve, adopt, validateRecovery, canReturnToSavedWork, returnToSavedWork, flush: drain,
        retry() { failure = null; return drain(); },
        run(taskId) { return state.runs[taskId]; },
        runs() { return Object.entries(state.runs); },
        pending() { return state.actions.length > 0; },
        failed() { return !!failure; },
        invalidate() { invalid = true; notify('Account changed. Reload to continue.', true); },
        startWork(taskId, sessionId, startedAt = Date.now()) {
            const run = reserve(taskId, startedAt);
            return commit('task start', [{path:'/work-intervals',method:'POST',body:{id:run.id,taskId,workSessionId:sessionId,startedAt:run.startedAt}}]).then(rows => rows[0].interval);
        },
        stopWork(id, endedAt) { return commit('task pause', [{path:`/work-intervals/${encodeURIComponent(id)}/stop`,method:'POST',body:{endedAt}}]).then(rows => rows[0].interval); },
        openIntervals(id) { return request(`/work-sessions/${encodeURIComponent(id)}/open-intervals`).then(body => body.intervals); }
    };
})();
