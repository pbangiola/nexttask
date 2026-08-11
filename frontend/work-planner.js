'use strict';

(() => {
    const originalResumeExistingList = window.resumeExistingList;
    const originalServerPayload = window.serverPayload;

    function taskFromRow(row, rootId) {
        const task = createTask(row.name, {
            id: row.id,
            estimatedTimeMs: row.estimated_ms,
            actualTimeMs: row.elapsed_ms,
            completed: false,
            status: row.status,
            created: row.created,
            started: row.started,
            lastChanged: null,
            blockedByTaskId: null
        });
        task.parentId = row.parent_id ?? null;
        task.nodeType = row.node_type || 'task';
        task.independentlyActionable = Number(row.independently_actionable) !== 0;
        task.priorityRootId = rootId || row.id;
        return task;
    }

    window.serverPayload = function serverPayloadWithNodeMetadata() {
        const payload = originalServerPayload();
        payload.tasks.forEach((row, index) => {
            const task = sortedTasks[index];
            if (!task) return;
            row.parentId = task.parentId ?? null;
            row.nodeType = task.nodeType || 'task';
            row.independentlyActionable = task.independentlyActionable !== false;
            row.priorityRootId = task.priorityRootId || task.id;
        });
        return payload;
    };

    async function ensureUser() {
        const response = await fetch(`${API_BASE_URL}/api/users/${encodeURIComponent(userId)}`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{}'
        });
        if (!response.ok) throw new Error(`User setup failed (${response.status})`);
    }

    async function fetchWorkPlan(rootId = null) {
        const params = new URLSearchParams();
        params.set('availableMs', String(totalAvailableTimeMs || 0));
        if (rootId) params.set('rootId', rootId);
        const response = await fetch(`${API_BASE_URL}/api/users/${encodeURIComponent(userId)}/work-plan?${params.toString()}`);
        let body = null;
        try { body = await response.json(); } catch (_) {}
        if (!response.ok) throw new Error(body?.error || `Work plan failed (${response.status})`);
        return body;
    }

    function flattenTree(nodes, out = []) {
        for (const node of nodes || []) {
            out.push(node);
            flattenTree(node.children || [], out);
        }
        return out;
    }

    async function fetchRootProjects() {
        const response = await fetch(`${API_BASE_URL}/api/users/${encodeURIComponent(userId)}/nodes?tree=1`);
        let body = null;
        try { body = await response.json(); } catch (_) {}
        if (!response.ok) throw new Error(body?.error || `Project list failed (${response.status})`);
        const roots = body.nodes || [];
        const isOpenProject = node => node.node_type === 'project' && !['completed', 'cancelled'].includes(node.status);
        const rootProjects = roots.filter(isOpenProject);
        if (rootProjects.length) return rootProjects;
        // Compatibility fallback: if older/edited data left project nodes nested under
        // another root, do not hide them from Work entirely.
        return flattenTree(roots).filter(isOpenProject);
    }

    function changeAvailableTime() {
        clearSessionTiming();
        timeLimitNextStep = 'resume-list';
        showTimeConstraint();
    }

    function showWorkPlan(plan, projectName = '') {
        hideStaticScreens(); hide(el('stopWorkingBtn')); show(el('startOverBtn'));
        const container = clearDynamic(); const screen = document.createElement('div'); screen.id = 'workPlanScreen';
        const heading = document.createElement('h2');
        heading.textContent = projectName ? (plan.available_ms ? `${projectName}: ${Math.round(plan.available_ms / 60000)} minute plan` : projectName) : (plan.available_ms ? `Your ${Math.round(plan.available_ms / 60000)} minute plan` : 'Your work plan');
        screen.appendChild(heading);
        if (!plan.tasks?.length) {
            const note = document.createElement('p'); note.textContent = plan.available_ms ? 'No estimated actionable task fits completely in the time available.' : 'No estimated actionable tasks were found.'; screen.appendChild(note);
        } else {
            const list = document.createElement('ol');
            plan.tasks.forEach(candidate => { const item = document.createElement('li'); const path = (candidate.path || []).slice(0, -1).map(node => node.name).join(' › '); item.textContent = `${candidate.task.name} — ${Math.round(Number(candidate.task.estimated_ms || 0) / 60000)} min${path ? ` (${path})` : ''}`; list.appendChild(item); });
            screen.appendChild(list); const total = document.createElement('p'); total.textContent = plan.available_ms ? `${Math.round(plan.planned_ms / 60000)} minutes planned • ${Math.round(plan.remaining_ms / 60000)} minutes unfilled` : `${Math.round(plan.planned_ms / 60000)} minutes planned`; screen.appendChild(total);
        }
        const work = document.createElement('button'); work.textContent = 'Work This Plan'; work.disabled = !plan.tasks?.length;
        work.onclick = () => { sortedTasks = plan.tasks.map(candidate => taskFromRow(candidate.task, candidate.root?.id)); activeTaskId = firstIncompleteTask()?.id || null; save('dashboard'); showDashboard(); };
        const change = document.createElement('button'); change.textContent = 'Change Available Time'; change.onclick = changeAvailableTime;
        const back = document.createElement('button'); back.textContent = 'Back'; back.onclick = showResumeSourceChoice;
        screen.append(work, change, back); container.appendChild(screen); saveLocal('work-choice');
    }

    async function loadTodoList() {
        if (!totalAvailableTimeMs) return originalResumeExistingList();
        hideStaticScreens(); const container = clearDynamic(); container.textContent = 'Building a work plan…';
        try { await ensureUser(); const plan = await fetchWorkPlan(); showWorkPlan(plan); }
        catch (error) { console.error(error); alert('A work plan could not be built from the saved backlog.'); showResumeSourceChoice(); }
    }

    async function showProjectWorkList() {
        hideStaticScreens(); hide(el('stopWorkingBtn')); show(el('startOverBtn'));
        const container = clearDynamic(); container.textContent = 'Loading projects…';
        try {
            await ensureUser(); const projects = await fetchRootProjects(); container.innerHTML = '';
            const screen = document.createElement('div'); screen.id = 'workProjectSelectScreen';
            const heading = document.createElement('h2'); heading.textContent = 'Work on My Projects'; screen.appendChild(heading);
            if (!projects.length) {
                const note = document.createElement('p'); note.textContent = 'You do not have any planned projects yet.';
                const planner = document.createElement('button'); planner.textContent = 'Open Project Planner'; planner.onclick = () => window.ProjectPlanner?.open?.();
                const start = document.createElement('button'); start.textContent = 'Back to Start'; start.onclick = showModeSelect;
                screen.append(note, planner, start); container.appendChild(screen); return;
            }
            const list = document.createElement('div'); list.className = 'planner-list';
            projects.forEach(project => {
                const button = document.createElement('button'); const mins = Math.round(Number(project.estimated_ms || 0) / 60000); button.textContent = mins ? `${project.name} — ${mins} min estimated` : project.name;
                button.onclick = async () => { button.disabled = true; try { const plan = await fetchWorkPlan(project.id); showWorkPlan(plan, project.name); } catch (error) { console.error(error); alert('That project could not be loaded for work.'); button.disabled = false; } };
                list.appendChild(button);
            });
            const back = document.createElement('button'); back.textContent = 'Back'; back.onclick = showResumeSourceChoice; screen.append(list, back); container.appendChild(screen); saveLocal('work-choice');
        } catch (error) { console.error(error); alert('Projects could not be loaded.'); showResumeSourceChoice(); }
    }

    function showResumeSourceChoice() {
        hideStaticScreens(); hide(el('stopWorkingBtn')); show(el('startOverBtn'));
        const container = clearDynamic(); const screen = document.createElement('div'); screen.id = 'resumeSourceChoiceScreen';
        const heading = document.createElement('h2'); heading.textContent = 'What do you want to work on?';
        const todo = document.createElement('button'); todo.textContent = 'Work on My To-Do List'; todo.onclick = loadTodoList;
        const projects = document.createElement('button'); projects.textContent = 'Work on My Projects'; projects.onclick = showProjectWorkList;
        const start = document.createElement('button'); start.textContent = 'Back to Start'; start.onclick = showModeSelect;
        screen.append(heading, todo, projects, start); container.appendChild(screen); saveLocal('work-choice');
    }

    window.resumeExistingList = showResumeSourceChoice;

    window.showBlockedFlow = function showStructuralBlockedFlow(blockedTask) {
        hideStaticScreens(); hide(el('stopWorkingBtn')); const container = clearDynamic(); const screen = document.createElement('div'); screen.id = 'blockedTaskScreen';
        const heading = document.createElement('h2'); heading.textContent = `What is blocking “${blockedTask.name}”?`; const input = document.createElement('input'); input.placeholder = 'Missing prerequisite';
        const confirm = document.createElement('button'); confirm.textContent = 'Add Blocker and Requeue Project';
        confirm.onclick = async () => { const blockerName = input.value.trim(); if (!blockerName) return alert('Enter the missing prerequisite.'); confirm.disabled = true; try { const response = await fetch(`${API_BASE_URL}/api/users/${encodeURIComponent(userId)}/nodes/${encodeURIComponent(blockedTask.id)}/blocker`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ blockerName }) }); const result = await response.json(); if (!response.ok) throw new Error(result?.error || `Blocked update failed (${response.status})`); const rootId = blockedTask.priorityRootId || result.project.id; const blocker = taskFromRow(result.blocker, rootId); const work = taskFromRow(result.work, rootId); const index = sortedTasks.findIndex(task => task.id === blockedTask.id); if (index >= 0) sortedTasks.splice(index, 1); sortedTasks.push(blocker, work); activeTaskId = firstIncompleteTask()?.id || null; save('dashboard'); showDashboard(); } catch (error) { console.error(error); alert(error.message || 'The blocker could not be added.'); confirm.disabled = false; } };
        const cancel = document.createElement('button'); cancel.textContent = 'Cancel and Continue Working'; cancel.onclick = () => showFocus(blockedTask);
        screen.append(heading, input, confirm, cancel); container.appendChild(screen); saveLocal('focus');
    };
})();
