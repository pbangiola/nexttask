'use strict';

(() => {
    const originalServerPayload = window.serverPayload;
    let workTreeCache = [];
    let projectFocusId = null;
    const projectHistory = [];

    function isOpen(node) {
        return node && !['completed', 'cancelled'].includes(String(node.status || '').toLowerCase());
    }

    function minutes(ms) {
        return Math.round(Number(ms || 0) / 60000);
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

            if (node.node_type === 'project') continue;
            out.push(taskFromLeaf(node, displayName, nodeRootId));
        }
        return out;
    }

    function flattenAllNodes(nodes, out = []) {
        for (const node of nodes || []) {
            out.push(node);
            flattenAllNodes(node.children || [], out);
        }
        return out;
    }

    function findNode(nodes, id) {
        for (const node of nodes || []) {
            if (node.id === id) return node;
            const found = findNode(node.children || [], id);
            if (found) return found;
        }
        return null;
    }

    function hasOpenChildren(node) {
        return (node?.children || []).some(isOpen);
    }

    function isProjectLike(node) {
        return isOpen(node) && (node.node_type === 'project' || hasOpenChildren(node));
    }

    function leafStats(node) {
        if (!isOpen(node)) return { parts: 0, ms: 0 };
        const children = (node.children || []).filter(isOpen);
        if (!children.length) {
            if (node.node_type === 'project') return { parts: 0, ms: 0 };
            return { parts: 1, ms: Number(node.estimated_ms || 0) };
        }
        return children.reduce((sum, child) => {
            const stats = leafStats(child);
            sum.parts += stats.parts;
            sum.ms += stats.ms;
            return sum;
        }, { parts: 0, ms: 0 });
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

    async function loadTree() {
        await ensureUser();
        workTreeCache = await fetchTaskTree();
        return workTreeCache;
    }

    function startNodes(nodes) {
        sortedTasks = flattenTree(nodes);
        activeTaskId = firstIncompleteTask()?.id || null;
        if (!sortedTasks.length) {
            alert('There are no unfinished executable tasks here.');
            return false;
        }
        save('dashboard');
        beginWork();
        return true;
    }

    async function loadFlattenedBacklog(startImmediately = true) {
        hideStaticScreens();
        hide(el('stopWorkingBtn'));
        const container = clearDynamic();
        container.textContent = 'Loading saved tasks…';

        try {
            const tree = await loadTree();
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

    function showExistingSelection() {
        hideStaticScreens();
        hide(el('stopWorkingBtn'));
        show(el('startOverBtn'));
        const container = clearDynamic();
        const screen = document.createElement('div');
        screen.id = 'existingWorkSelectScreen';
        const heading = document.createElement('h2');
        heading.textContent = 'Select Existing Work';
        const note = document.createElement('p');
        note.textContent = 'Choose your full task list or focus on one project.';
        const list = document.createElement('div');
        list.className = 'planner-list';

        const all = document.createElement('button');
        all.textContent = 'Entire Task List';
        all.onclick = () => loadFlattenedBacklog(true);
        list.appendChild(all);

        const roots = (workTreeCache || []).filter(isOpen);
        const projects = roots.filter(isProjectLike);
        projects.forEach(project => {
            const stats = leafStats(project);
            const button = document.createElement('button');
            button.textContent = `${project.name} — ${stats.parts} part${stats.parts === 1 ? '' : 's'} • ${minutes(stats.ms)} min`;
            button.onclick = () => {
                projectHistory.length = 0;
                showProjectOverview(project.id, false);
            };
            list.appendChild(button);
        });

        if (!projects.length) {
            const empty = document.createElement('p');
            empty.textContent = 'No projects found. You can still resume your entire task list.';
            list.appendChild(empty);
        }

        const back = document.createElement('button');
        back.textContent = 'Back';
        back.onclick = showWorkChoice;
        screen.append(heading, note, list, back);
        container.appendChild(screen);
        saveLocal('work-choice');
    }

    function showProjectOverview(projectId, pushHistory = true) {
        const node = findNode(workTreeCache, projectId);
        if (!node || !isProjectLike(node)) {
            alert('That project could not be found.');
            showExistingSelection();
            return;
        }

        if (pushHistory && projectFocusId && projectFocusId !== projectId) projectHistory.push(projectFocusId);
        projectFocusId = projectId;

        hideStaticScreens();
        hide(el('stopWorkingBtn'));
        show(el('startOverBtn'));
        const container = clearDynamic();
        const screen = document.createElement('div');
        screen.id = 'workProjectOverviewScreen';

        const stats = leafStats(node);
        const heading = document.createElement('h2');
        heading.textContent = `Overview: ${node.name}`;
        const meta = document.createElement('p');
        meta.textContent = `Total parts: ${stats.parts}. Total estimated time: ${minutes(stats.ms)} minutes.`;
        screen.append(heading, meta);

        const directChildren = (node.children || []).filter(isOpen);
        const subprojects = directChildren.filter(isProjectLike);
        const subheading = document.createElement('h3');
        subheading.textContent = 'Subprojects';
        screen.appendChild(subheading);

        const list = document.createElement('div');
        list.className = 'planner-list';
        if (!subprojects.length) {
            const none = document.createElement('p');
            none.textContent = 'No subprojects at this level.';
            list.appendChild(none);
        }

        subprojects.forEach(subproject => {
            const substats = leafStats(subproject);
            const link = document.createElement('button');
            link.className = 'planner-project-link';
            link.textContent = subproject.name;
            link.onclick = () => showProjectOverview(subproject.id, true);
            const row = document.createElement('div');
            row.className = 'planner-project-row';
            const details = document.createElement('span');
            details.textContent = `${substats.parts} part${substats.parts === 1 ? '' : 's'} • ${minutes(substats.ms)} min`;
            row.append(link, details);
            list.appendChild(row);
        });
        screen.appendChild(list);

        const controls = document.createElement('div');
        controls.className = 'planner-choice-grid';
        const start = document.createElement('button');
        start.textContent = 'Start This Project';
        start.onclick = () => startNodes([node]);
        const manage = document.createElement('button');
        manage.textContent = 'Manage';
        manage.onclick = () => window.ProjectEditor?.open?.(node.id, { push: false });
        controls.append(start, manage);
        screen.appendChild(controls);

        const back = document.createElement('button');
        back.textContent = 'Back';
        back.onclick = () => {
            if (projectHistory.length) {
                const previous = projectHistory.pop();
                projectFocusId = null;
                showProjectOverview(previous, false);
                return;
            }
            projectFocusId = null;
            showExistingSelection();
        };
        screen.appendChild(back);
        container.appendChild(screen);
        saveLocal('work-choice');
    }

    // Resume Existing now means select either the whole backlog or a project. Time-limit
    // setup still happens before this call and only controls when the session stops.
    window.resumeExistingList = async () => {
        hideStaticScreens();
        const container = clearDynamic();
        container.textContent = 'Loading saved work…';
        try {
            await loadTree();
            showExistingSelection();
        } catch (error) {
            console.error(error);
            alert('The saved task list could not be loaded.');
            showWorkChoice();
        }
    };

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
})();
