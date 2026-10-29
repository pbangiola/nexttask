'use strict';

window.FocusDurability = (() => {
    let busy = false;
    let preparing = null;
    let initialized = false;
    let needsPreparation = true;
    const graph = window.TaskGraph;
    const encode = encodeURIComponent;
    const step = (path, body, method = 'POST') => ({ path, method, body });
    const eligible = task => !task.completed && ['pending', 'active'].includes(task.status)
        && (task.nodeType || 'task') === 'task' && task.independentlyActionable !== false
        && (!window.PlanExecution || window.PlanExecution.allowed(task));
    const queue = tasks => tasks.filter(task => !task.completed && ['pending','active'].includes(task.status) && (task.nodeType || 'task') === 'task' && task.independentlyActionable !== false).map(task => task.id);
    const boundary = now => hasHardStop() ? Math.min(now, hardStopAtMs) : now;

    function payload(tasks = sortedTasks) {
        return {
            totalAvailableTimeMs, endConstraint,
            tasks: tasks.map((task, index) => ({
                id: task.id, name: task.canonicalName || task.name,
                parentId: task.parentId ?? null, nodeType: task.nodeType || 'task',
                independentlyActionable: task.independentlyActionable !== false,
                position: task.nodePosition ?? index + 1,
                status: task.completed ? 'completed' : task.status,
                estimatedTimeMs: task.estimatedTimeMs, actualTimeMs: task.actualTimeMs,
                created: task.created, started: task.started, completedTime: task.completedTime,
                lastChanged: task.lastChanged, blockedByTaskId: task.blockedByTaskId
            }))
        };
    }
    function snapshot(tasks = sortedTasks) { return step(`/session/${encode(userId)}/tasks`, payload(tasks), 'PUT'); }
    function stopSteps(at) {
        return graph.runs().map(([taskId, run]) => ({
            ...step(`/work-intervals/${encode(run.id)}/stop`, { endedAt: at }), runTaskId: taskId
        }));
    }
    function items(tasks) { return step(`/work-sessions/${encode(window.activeWorkSessionId)}/items`, { taskIds: queue(tasks) }, 'PUT'); }
    function end(at) { return step(`/work-sessions/${encode(window.activeWorkSessionId)}/end`, { endedAt: at }); }
    function saving(message = 'Saving…', failed = false) {
        let panel = el('durabilityStatus');
        if (!panel) {
            panel = document.createElement('div');
            panel.id = 'durabilityStatus';
            panel.setAttribute('role', 'status');
            el('taskSorterApp')?.appendChild(panel);
        }
        panel.replaceChildren(document.createTextNode(message));
        if (failed) {
            const retry = document.createElement('button');
            retry.textContent = 'Retry Save';
            retry.onclick = () => {
                retry.disabled = true;
                graph.retry().then(() => initialized ? undefined : init()).catch(() => saving('Save pending. Retry before continuing.', true));
            };
            panel.appendChild(retry);
            if (graph.canReturnToSavedWork()) {
                const previous = document.createElement('button');
                previous.textContent = 'Return to Saved Work';
                previous.onclick = async () => {
                    previous.disabled = true;
                    try { await graph.returnToSavedWork(); busy = false; preparing = null; await recover(); }
                    catch (_) { saving('Saved work could not be recovered. Retry to continue.', true); }
                };
                panel.appendChild(previous);
            }
        }
    }
    function recoveryNote(message) {
        const note = document.createElement('p');
        note.textContent = message;
        el('dashboardScreen')?.appendChild(note);
    }
    window.addEventListener('durability-status', event => saving(event.detail.message, event.detail.failed));
    function submit(label, steps, ack) {
        return graph.commit(label, steps, ack).catch(error => {
            saving('Save pending. Retry before continuing.', true);
            throw error;
        });
    }
    function guard(action) {
        if (busy || graph.failed()) return;
        busy = true;
        try {
            const result = action(() => { busy = false; });
            result?.catch(() => {});
            return result;
        } catch (error) { busy = false; saving(error.message, true); }
    }
    async function prepare() {
        if (preparing) return preparing;
        const ids = queue(sortedTasks);
        if (!ids.length) return;
        const at = Date.now();
        const id = createId('work_session');
        saving('Preparing saved work…');
        preparing = submit('work preparation', [snapshot(), step('/work-sessions/prepare', {
            id, taskIds: ids, startedAt: at, availableMs: totalAvailableTimeMs,
            hardStopAt: hardStopAtMs || null, endConstraint,
            replaceSessionId: window.activeWorkSessionId, replacedAt: boundary(at)
        })], () => { needsPreparation = false; window.TaskGraphTiming.clear(); });
        try { await preparing; } finally { preparing = null; }
    }
    async function enter(task) {
        if (busy || graph.failed() || !eligible(task)) return;
        if (hasHardStop() && Date.now() >= hardStopAtMs) return hardStop();
        try {
            if (needsPreparation || !window.activeWorkSessionId) await prepare();
            if (busy || graph.failed() || !window.activeWorkSessionId) return;
            if (hasHardStop() && Date.now() >= hardStopAtMs) return hardStop();
            if (task.estimatedTimeMs <= 0) { showSingleTaskEstimate(task); return; }
            // Do not render a second running clock/interval on duplicate entry.
            if (el('focusScreen') && activeTaskId === task.id && task.lastChanged !== null) return;
            const at = Date.now();
            startTaskClock(task, at);
            const run = graph.reserve(task.id, at);
            const promise = submit('task start', [step('/work-intervals', {
                id: run.id, taskId: task.id, workSessionId: window.activeWorkSessionId, startedAt: run.startedAt
            }), snapshot()]);
            renderFocus(task);
            saveLocal('focus');
            await promise;
        } catch (_) { /* Journal retains the rejected request for explicit retry. */ }
    }
    function done(task, at = Date.now()) {
        return guard(release => {
            const stoppedAt = boundary(at);
            clearInterval(timerInterval); window.FocusAlarm?.stop();
            pauseTaskClock(task, stoppedAt);
            saveLocal('focus');
            const projected = sortedTasks.map(row => ({ ...row }));
            completeTask(projected.find(row => row.id === task.id), stoppedAt);
            for (const row of projected) {
                if (row.status === 'blocked' && row.blockedByTaskId === task.id) {
                    row.status = 'pending'; row.blockedByTaskId = null;
                }
            }
            const finished = !projected.some(row => !row.completed && row.status !== 'cancelled');
            const steps = [...stopSteps(stoppedAt), snapshot(projected), items(projected)];
            if (finished) steps.push(end(stoppedAt));
            return submit('task completion', steps, () => {
                window.FocusAlarm?.cancel(task);
                sortedTasks = projected;
                window.TaskGraphTiming.forget(task.id);
                activeTaskId = firstIncompleteTask()?.id || null;
                release();
                if (finished) { clearInterval(hardStopInterval); showCompletion(); }
                else if (firstIncompleteTask()) beginWork();
                else { showDashboard(); saving('Remaining tasks are blocked. Add or complete their blocker to continue.'); }
            });
        });
    }
    function pause(task, after, at = Date.now()) {
        return guard(release => {
            const stoppedAt = boundary(at);
            clearInterval(timerInterval); window.FocusAlarm?.stop();
            if (task) pauseTaskClock(task, stoppedAt);
            saveLocal('dashboard');
            return submit('task pause', [...stopSteps(stoppedAt), snapshot()], () => {
                window.TaskGraphTiming.clear(); release(); after?.();
            });
        });
    }
    function snooze(parentId, resume=false, at=Date.now()) {
        if(!window.activeWorkSessionId||!window.ProjectQueue?.snoozed(sortedTasks,parentId))return;
        return guard(release=>{
            const stoppedAt=boundary(at);clearInterval(timerInterval); window.FocusAlarm?.stop();
            const active=currentTask();if(active)pauseTaskClock(active,stoppedAt);
            const projected=window.ProjectQueue.snoozed(sortedTasks,parentId).map(task=>({...task}));
            saveLocal('dashboard');
            return submit('parent snooze',[...stopSteps(stoppedAt),snapshot(projected),items(projected)],()=>{
                sortedTasks=projected;activeTaskId=firstIncompleteTask()?.id||null;
                window.TaskGraphTiming.clear();release();
                if(resume&&firstIncompleteTask())beginWork();else showDashboard();
            });
        });
    }
    function add(newTask, insertIndex, activeTask) {
        return guard(release => {
            const projected = sortedTasks.map(row => ({ ...row }));
            projected.splice(insertIndex, 0, newTask);
            return submit('new task', [snapshot(projected), items(projected)], () => {
                sortedTasks = projected; release(); showFocus(sortedTasks.find(row => row.id === activeTask.id));
            });
        });
    }
    function blocker(blockedTask, newTask) {
        return guard(release => {
            const projected = sortedTasks.filter(row => row.id !== blockedTask.id).map(row => ({ ...row }));
            // The canonical blocker row must exist before the dependent reference.
            projected.push(newTask, { ...blockedTask, status: 'blocked', blockedByTaskId: newTask.id, lastChanged: null });
            return submit('blocker', [snapshot(projected), items(projected)], () => {
                sortedTasks = projected; activeTaskId = firstIncompleteTask()?.id || null; release(); showDashboard();
            });
        });
    }
    function finish(completedIds = [], at = Date.now(), hard = false, reset = false) {
        return guard(release => {
            const stoppedAt = boundary(at);
            clearInterval(timerInterval); window.FocusAlarm?.stop(); clearInterval(hardStopInterval);
            const task = currentTask();
            if (task?.lastChanged !== null && task) pauseTaskClock(task, stoppedAt);
            const projected = sortedTasks.map(row => ({ ...row }));
            projected.filter(row => completedIds.includes(row.id)).forEach(row => completeTask(row, stoppedAt));
            if (reset || hard) projected.filter(row => row.isSortingOverhead && !row.completed).forEach(row => completeTask(row, stoppedAt));
            for (const row of projected) {
                if (row.status === 'blocked' && completedIds.includes(row.blockedByTaskId)) { row.status = 'pending'; row.blockedByTaskId = null; }
            }
            saveLocal(hard ? 'session-ended' : 'dashboard');
            const steps = [...stopSteps(stoppedAt), snapshot(projected)];
            if (window.activeWorkSessionId && (!needsPreparation || reset)) steps.push(end(stoppedAt));
            return submit('session end', steps, () => {
                sortedTasks = projected;
                window.TaskGraphTiming.clear(); release();
                if (reset) {
                    localStorage.removeItem(LOCAL_STATE_KEY);
                    sortedTasks = []; activeTaskId = null; sortRunId++; currentSortNames = [];
                    window.currentExistingSort = null;
                    clearSessionTiming(); endConstraint = ''; window.currentWorkProjectContext = null; showModeSelect();
                } else if (hard) showSessionEnded();
                else { clearSessionTiming(); activeTaskId = firstIncompleteTask()?.id || null; if (incompleteTasks().length) showDashboard(); else showCompletion(); }
            });
        });
    }
    function hardStop() {
        if (hardStopHandled || !hasHardStop()) return;
        // If a complete action is underway, its acknowledgement will reach enter
        // again; retain the recorded deadline and do not stamp detection time.
        if (busy || graph.failed()) return;
        hardStopHandled = true;
        return finish([], hardStopAtMs, true);
    }
    function recoveredTask(row, nodes) {
        const path = [], projectAncestorIds = [];
        let parent = nodes.get(row.parent_id);
        const seen = new Set();
        while (parent && !seen.has(parent.id)) { seen.add(parent.id); projectAncestorIds.unshift(parent.id); path.unshift(parent.name); parent = nodes.get(parent.parent_id); }
        const task = createTask([...path, row.name].join(': '), {
            id: row.id, estimatedTimeMs: row.estimated_ms, actualTimeMs: row.elapsed_ms,
            status: row.status, completed: row.status === 'completed', completedTime: row.completed,
            created: row.created, started: row.started, lastChanged: null, blockedByTaskId: row.blocked_by_task_id
        });
        Object.assign(task, { projectAncestorIds, projectAncestorNames:path, canonicalName: row.name, parentId: row.parent_id, nodeType: row.node_type,
            nodePosition: row.position, independentlyActionable: row.independently_actionable === 1, projectPath: path.join(' › ') });
        return task;
    }
    async function recover() {
        window.currentWorkProjectContext = null;
        // Replay only this owner's immutable pending requests before discovering
        // canonical state. Closed server rows can never be resurrected by cache.
        const serverClosed = await graph.validateRecovery();
        await graph.flush();
        const { workSession } = await graph.request('/work-sessions/open');
        if (!workSession) {
            graph.adopt(null, []);
            const cached = restoreLocalState();
            const { nodes: tree } = await graph.request(`/users/${encode(userId)}/nodes?tree=1`);
            const byId = new Map();
            function index(list) { for (const row of list) { byId.set(row.id, row); index(row.children || []); } }
            index(tree);
            // Unsaved legacy input/sorting can be retained, but never auto-started.
            if (cached) sortedTasks = sortedTasks.map(task => {
                const row = byId.has(task.id) ? recoveredTask(byId.get(task.id), byId) : task;
                row.isSortingOverhead = task.isSortingOverhead || (cached.view === 'sorting' && cached.activeTaskId === task.id && task.name === 'Sort Tasks');
                if (row.isSortingOverhead) row.independentlyActionable = false;
                return row;
            }).filter(task => !cached.workSessionId || byId.has(task.id));
            const interruptedSorting = sortedTasks.filter(task => task.isSortingOverhead && !task.completed);
            if (interruptedSorting.length) {
                interruptedSorting.forEach(task => { task.lastChanged = null; completeTask(task, Date.now()); });
                await submit('interrupted sorting history', [snapshot()]);
            }
            clearSessionTiming();
            activeTaskId = firstIncompleteTask()?.id || null;
            if (sortedTasks.length) {
                showDashboard();
                recoveryNote(serverClosed
                    ? 'The previous session is closed. Pending local transitions were cancelled. Review the saved list before starting again.'
                    : 'Recovered list is paused. Get to Work starts a new session.');
            }
            else showModeSelect();
            return;
        }
        const [{ items: rows, history }, intervals, { nodes: tree }] = await Promise.all([
            graph.request(`/work-sessions/${encode(workSession.id)}`), graph.openIntervals(workSession.id),
            graph.request(`/users/${encode(userId)}/nodes?tree=1`)
        ]);
        const nodes = new Map();
        function index(list) { for (const row of list) { nodes.set(row.id, row); index(row.children || []); } }
        index(tree);
        graph.adopt(workSession.id, intervals);
        needsPreparation = false;
        const recovered = new Map(rows.map(row => [row.id, nodes.get(row.id) || row]));
        for (const row of history) if (!recovered.has(row.id)) recovered.set(row.id, nodes.get(row.id) || row);
        // Blocked dependents are not executable queue items, but their canonical
        // relationship must survive server-only recovery of the blocker.
        let changed = true;
        while (changed) {
            changed = false;
            for (const row of nodes.values()) {
                if (!recovered.has(row.id) && row.blocked_by_task_id && recovered.has(row.blocked_by_task_id)) {
                    recovered.set(row.id, row); changed = true;
                }
            }
        }
        const cached = restoreLocalState();
        if (cached?.workSessionId === workSession.id) {
            for (const task of sortedTasks) {
                const row = nodes.get(task.id);
                if (row && !recovered.has(row.id) && ['completed', 'cancelled'].includes(row.status)) recovered.set(row.id, row);
            }
        }
        sortedTasks = [...recovered.values()].map(row => recoveredTask(row, nodes));
        activeTaskId = firstIncompleteTask()?.id || null;
        const roots = new Map();
        for (const row of rows) {
            let root = nodes.get(row.id) || row;
            const seen = new Set();
            while (nodes.has(root.parent_id) && !seen.has(root.id)) { seen.add(root.id); root = nodes.get(root.parent_id); }
            roots.set(root.id, root);
        }
        const project = roots.size === 1 ? [...roots.values()][0] : null;
        window.currentWorkProjectContext = project?.node_type === 'project' ? { id: project.id, name: project.name, estimatedMs: project.estimated_ms, startedAtMs: workSession.started_at } : null;
        totalAvailableTimeMs = workSession.available_ms; sessionStartedAtMs = workSession.started_at;
        hardStopAtMs = workSession.hard_stop_at || 0; endConstraint = workSession.end_constraint; hardStopHandled = false;
        // Recover uncheckpointed clock time before closing the open intervals.
        // Save the checkpoint first in the immutable journal: if recovery is
        // interrupted, replay cannot add this same interval segment twice.
        const at = boundary(Date.now());
        for (const interval of intervals) {
            const task = sortedTasks.find(row => row.id === interval.task_id);
            if (!task || task.completed) continue;
            const row = nodes.get(task.id);
            const checkpoint = Math.max(interval.started_at, row?.last_changed ?? interval.started_at);
            task.actualTimeMs += Math.max(0, at - checkpoint);
            task.lastChanged = Math.max(checkpoint, at);
        }
        await submit('recovery pause', [snapshot(), ...intervals.map(row => step(`/work-intervals/${encode(row.id)}/stop`, { endedAt: at }))]);
        for (const task of sortedTasks) {
            task.lastChanged = null;
            if (task.status === 'active') task.status = 'pending';
        }
        window.TaskGraphTiming.clear();
        if (hasHardStop() && Date.now() >= hardStopAtMs) { await hardStop(); return; }
        const unfinished = sortedTasks.some(task => !task.completed && task.status !== 'cancelled');
        if (!unfinished) { await finish(); return; }
        showDashboard(); startHardStopWatch();
        recoveryNote('Saved work recovered and paused. Get to Work resumes. Elapsed time includes the recovered running interval.');
    }
    async function init() {
        if (initialized) return;
        bindEvents(); hideStaticScreens(); clearDynamic().textContent = 'Recovering saved work…';
        try { await recover(); initialized = true; }
        catch (_) {
            const container = clearDynamic();
            container.textContent = 'Saved work could not be recovered. Your saved work has been kept.';
            const retry = document.createElement('button'); retry.textContent = 'Retry Recovery';
            retry.onclick = () => graph.retry().then(init).catch(() => saving('Recovery pending. Retry to continue.', true));
            container.appendChild(retry);
            saving('Recovery pending. Retry to continue.', true);
        }
    }
    // Losing visibility is not a pause action. Keep the clock anchor and the
    // durable interval open; wall-clock time includes time spent away.
    function preserveRunningFocus() {
        if (el('focusScreen')) saveLocal('focus');
    }
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) preserveRunningFocus();
        if (!document.hidden && hasHardStop() && Date.now() >= hardStopAtMs) hardStop();
    });
    window.addEventListener('pagehide', preserveRunningFocus);
    return { init, recover, prepare, newWork() { needsPreparation = true; }, enter, done, pause, add, blocker, finish, hardStop, snapshot, payload, eligible, snooze };
})();
