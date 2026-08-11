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

    // Preserve hierarchy metadata when normal Work persistence writes a planned leaf
    // back to the canonical task-node table.
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

    async function fetchWorkPlan() {
        const response = await fetch(
            `${API_BASE_URL}/api/users/${encodeURIComponent(userId)}/work-plan?availableMs=${encodeURIComponent(totalAvailableTimeMs)}`
        );
        let body = null;
        try { body = await response.json(); } catch (_) {}
        if (!response.ok) throw new Error(body?.error || `Work plan failed (${response.status})`);
        return body;
    }

    function changeAvailableTime() {
        clearSessionTiming();
        timeLimitNextStep = 'resume-list';
        showTimeConstraint();
    }

    function showWorkPlan(plan) {
        hideStaticScreens();
        hide(el('stopWorkingBtn'));
        show(el('startOverBtn'));
        const container = clearDynamic();
        const screen = document.createElement('div');
        screen.id = 'workPlanScreen';

        const heading = document.createElement('h2');
        heading.textContent = `Your ${Math.round(plan.available_ms / 60000)} minute plan`;
        screen.appendChild(heading);

        if (!plan.tasks?.length) {
            const note = document.createElement('p');
            note.textContent = 'No estimated actionable task fits completely in the time available.';
            screen.appendChild(note);
        } else {
            const list = document.createElement('ol');
            plan.tasks.forEach(candidate => {
                const item = document.createElement('li');
                const path = (candidate.path || []).slice(0, -1).map(node => node.name).join(' › ');
                item.textContent = `${candidate.task.name} — ${Math.round(Number(candidate.task.estimated_ms || 0) / 60000)} min${path ? ` (${path})` : ''}`;
                list.appendChild(item);
            });
            screen.appendChild(list);
            const total = document.createElement('p');
            total.textContent = `${Math.round(plan.planned_ms / 60000)} minutes planned • ${Math.round(plan.remaining_ms / 60000)} minutes unfilled`;
            screen.appendChild(total);
        }

        const work = document.createElement('button');
        work.textContent = 'Work This Plan';
        work.disabled = !plan.tasks?.length;
        work.onclick = () => {
            sortedTasks = plan.tasks.map(candidate => taskFromRow(candidate.task, candidate.root?.id));
            activeTaskId = firstIncompleteTask()?.id || null;
            save('dashboard');
            showDashboard();
        };

        const change = document.createElement('button');
        change.textContent = 'Change Available Time';
        change.onclick = changeAvailableTime;
        screen.append(work, change);
        container.appendChild(screen);
        saveLocal('work-choice');
    }

    window.resumeExistingList = async function resumeExistingListWithTimeFit() {
        if (!totalAvailableTimeMs) return originalResumeExistingList();
        hideStaticScreens();
        const container = clearDynamic();
        container.textContent = 'Building a work plan…';
        try {
            await fetch(`${API_BASE_URL}/api/users/${encodeURIComponent(userId)}`, {
                method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{}'
            });
            const plan = await fetchWorkPlan();
            showWorkPlan(plan);
        } catch (error) {
            console.error(error);
            alert('A work plan could not be built from the saved backlog.');
            showWorkChoice();
        }
    };

    window.showBlockedFlow = function showStructuralBlockedFlow(blockedTask) {
        hideStaticScreens();
        hide(el('stopWorkingBtn'));
        const container = clearDynamic();
        const screen = document.createElement('div');
        screen.id = 'blockedTaskScreen';
        const heading = document.createElement('h2');
        heading.textContent = `What is blocking “${blockedTask.name}”?`;
        const input = document.createElement('input');
        input.placeholder = 'Missing prerequisite';
        const confirm = document.createElement('button');
        confirm.textContent = 'Add Blocker and Requeue Project';
        confirm.onclick = async () => {
            const blockerName = input.value.trim();
            if (!blockerName) return alert('Enter the missing prerequisite.');
            confirm.disabled = true;
            try {
                const response = await fetch(
                    `${API_BASE_URL}/api/users/${encodeURIComponent(userId)}/nodes/${encodeURIComponent(blockedTask.id)}/blocker`,
                    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ blockerName }) }
                );
                const result = await response.json();
                if (!response.ok) throw new Error(result?.error || `Blocked update failed (${response.status})`);

                const rootId = blockedTask.priorityRootId || result.project.id;
                const blocker = taskFromRow(result.blocker, rootId);
                const work = taskFromRow(result.work, rootId);
                const index = sortedTasks.findIndex(task => task.id === blockedTask.id);
                if (index >= 0) sortedTasks.splice(index, 1);
                sortedTasks.push(blocker, work);
                activeTaskId = firstIncompleteTask()?.id || null;
                save('dashboard');
                showDashboard();
            } catch (error) {
                console.error(error);
                alert(error.message || 'The blocker could not be added.');
                confirm.disabled = false;
            }
        };
        const cancel = document.createElement('button');
        cancel.textContent = 'Cancel and Continue Working';
        cancel.onclick = () => showFocus(blockedTask);
        screen.append(heading, input, confirm, cancel);
        container.appendChild(screen);
        saveLocal('focus');
    };
})();
