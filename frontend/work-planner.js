'use strict';

(() => {
    const originalServerPayload = window.serverPayload;

    function isOpen(node) {
        return node && !['completed', 'cancelled'].includes(String(node.status || '').toLowerCase());
    }

    function taskFromLeaf(row, displayName, rootId) {
        const task = createTask(displayName, {
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
        task.canonicalName = row.name;
        task.parentId = row.parent_id ?? null;
        task.nodeType = row.node_type || 'task';
        task.nodePosition = Number(row.position || 0);
        task.priorityRootId = rootId || row.id;
        return task;
    }

    function flattenTree(nodes, prefix = '', rootId = null, out = []) {
        for (const node of nodes || []) {
            if (!isOpen(node)) continue;
            const displayName = prefix ? `${prefix}: ${node.name}` : node.name;
            const children = (node.children || []).filter(isOpen);
            const nodeRootId = rootId || node.id;

            if (children.length) {
                flattenTree(children, displayName, nodeRootId, out);
                continue;
            }

            // Empty project containers are organizational, not executable work.
            if (node.node_type === 'project') continue;
            out.push(taskFromLeaf(node, displayName, nodeRootId));
        }
        return out;
    }

    async function fetchTaskTree() {
        const response = await fetch(`${API_BASE_URL}/api/users/${encodeURIComponent(userId)}/nodes?tree=1`);
        let body = null;
        try { body = await response.json(); } catch (_) {}
        if (!response.ok) throw new Error(body?.error || `Task list failed (${response.status})`);
        return body.nodes || [];
    }

    async function ensureUser() {
        const response = await fetch(`${API_BASE_URL}/api/users/${encodeURIComponent(userId)}`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{}'
        });
        if (!response.ok) throw new Error(`User setup failed (${response.status})`);
    }

    async function loadFlattenedBacklog(startImmediately = true) {
        hideStaticScreens();
        hide(el('stopWorkingBtn'));
        const container = clearDynamic();
        container.textContent = 'Loading saved tasks…';

        try {
            await ensureUser();
            const tree = await fetchTaskTree();
            sortedTasks = flattenTree(tree);
            activeTaskId = firstIncompleteTask()?.id || null;

            if (!sortedTasks.length) {
                alert('No unfinished saved tasks were found.');
                showWorkChoice();
                return;
            }

            save('dashboard');
            if (startImmediately) beginWork();
            else showDashboard();
        } catch (error) {
            console.error(error);
            alert('The saved task list could not be loaded.');
            showWorkChoice();
        }
    }

    // Resume is deliberately boring: time-limit choice happens before this call,
    // then the full saved task tree is flattened in sequence and Work begins.
    window.resumeExistingList = () => loadFlattenedBacklog(true);

    // Work uses display names with project prefixes, but persistence must keep the
    // canonical backend node name, parent and sibling position intact.
    window.serverPayload = function serverPayloadWithTreeMetadata() {
        const payload = originalServerPayload();
        payload.tasks.forEach((row, index) => {
            const task = sortedTasks[index];
            if (!task) return;
            row.name = task.canonicalName || task.name;
            row.parentId = task.parentId ?? null;
            row.nodeType = task.nodeType || 'task';
            row.position = Number(task.nodePosition || row.position || index + 1);
            row.priorityRootId = task.priorityRootId || task.id;
        });
        return payload;
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
        confirm.textContent = 'Add Blocker and Requeue';
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
                await loadFlattenedBacklog(false);
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
