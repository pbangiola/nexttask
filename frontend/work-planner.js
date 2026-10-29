'use strict';

(() => {
    const originalServerPayload = window.serverPayload;
    let workTreeCache = [];
    let projectFocusId = null;
    let sortSelectedWork = false;
    const projectHistory = [];

    function isOpen(node) {
        return node && !['completed', 'cancelled'].includes(String(node.status || '').toLowerCase());
    }

    function minutes(ms) {
        return Number(ms || 0) / 60000;
    }

    function taskFromLeaf(row, displayName, rootId, ancestorIds, ancestorNames) {
        const task = createTask(displayName, {
            id: row.id,
            estimatedTimeMs: row.estimated_ms,
            actualTimeMs: row.elapsed_ms,
            completed: false,
            status: row.status,
            created: row.created,
            started: row.started,
            lastChanged: null,
            blockedByTaskId: row.blocked_by_task_id
        });
        task.projectAncestorIds = [...ancestorIds];
        task.projectAncestorNames = [...ancestorNames];
        task.canonicalName = row.name;
        task.parentId = row.parent_id ?? null;
        task.nodeType = row.node_type || 'task';
        task.nodePosition = Number(row.position || 0);
        task.independentlyActionable = row.independently_actionable === 1;
        task.projectRootId = rootId || row.id;
        task.projectPath = displayName.includes(': ') ? displayName.split(': ').slice(0,-1).join(' › ') : '';
        return task;
    }

    function flattenTree(nodes, prefix = '', rootId = null, out = [], ancestorIds = [], ancestorNames = []) {
        for (const node of nodes || []) {
            if (!isOpen(node)) continue;
            const displayName = prefix ? `${prefix}: ${node.name}` : node.name;
            const children = (node.children || []).filter(isOpen);
            const nodeRootId = rootId || node.id;

            if (children.length) {
                flattenTree(children, displayName, nodeRootId, out, node.node_type==='project' ? [...ancestorIds,node.id] : ancestorIds,node.node_type==='project' ? [...ancestorNames,node.name] : ancestorNames);
                continue;
            }

            if (node.node_type === 'project' || node.independently_actionable !== 1) continue;
            out.push(taskFromLeaf(node, displayName, nodeRootId, ancestorIds, ancestorNames));
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
        return node && node.status!=='cancelled' && (node.node_type === 'project' || hasOpenChildren(node));
    }

    function leafStats(node) {
        const progress=node?.progress;
        if(progress)return {parts:progress.totalTasks-progress.completedTasks,ms:progress.remainingEstimateMs};
        return {parts:isOpen(node)&&node.node_type==='task'?1:0,ms:isOpen(node)?Number(node.estimated_ms||0):0};
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
        await window.PlanExecution?.refresh();
        await ensureUser();
        workTreeCache = await fetchTaskTree();
        return workTreeCache;
    }

    function sortingChoice() {
        const label = document.createElement('label');
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox'; checkbox.checked = sortSelectedWork;
        checkbox.style.width = 'auto';
        checkbox.onchange = () => { sortSelectedWork = checkbox.checked; };
        label.append(checkbox, document.createTextNode(' Sort selected work by importance before Focus'));
        return label;
    }

    async function orderSelectedWork(nodes) {
        window.FocusDurability.newWork();
        if (!sortSelectedWork) return;
        const executable = nodes.filter(node=>flattenTree([node]).some(window.FocusDurability.eligible));
        if (executable.length < 2) return;
        const other = nodes.filter(node=>!executable.includes(node));
        const at = Date.now();
        const sorting = createTask('Sort Tasks', { estimatedTimeMs: estimatedSortingTimeMs(executable.length), status: 'active', started: at, lastChanged: at });
        sorting.isSortingOverhead = true;
        sorting.independentlyActionable = false;
        window.currentExistingSort = sorting;
        sortedTasks = [sorting, ...flattenTree([...executable,...other])];
        const runId = ++sortRunId;
        clearDynamic(); hideStaticScreens(); show(el('startOverBtn'));
        prepareSortingDisplay(sorting);
        save('sorting');
        const ordered = await interactiveMergeSort(executable, runId);
        if (runId !== sortRunId) return false;
        clearInterval(timerInterval); completeTask(sorting, Date.now());
        window.currentExistingSort = null;
        sortedTasks = [sorting, ...flattenTree([...ordered,...other])];
        hide(el('taskCompare'));
        await save('dashboard');
        await window.NextPlan?.recordImportance(ordered);
    }

    async function startNodes(nodes,startImmediately=true) {
        const root=nodes?.length===1?nodes[0]:null; window.currentWorkProjectContext=root?.node_type==='project'?{id:root.id,name:root.name,estimatedMs:leafStats(root).ms,startedAtMs:Date.now(),deadlineAtMs:Number(root.deadline_at||root.due_at||root.deadline||0)}:null;
        sortedTasks = flattenTree(nodes);
        activeTaskId = firstIncompleteTask()?.id || null;
        if (!sortedTasks.length) {
            alert('There are no unfinished executable tasks here.');
            return false;
        }
        if (await orderSelectedWork(nodes) === false) return false;
        await window.FocusDurability.prepare();
        if(startImmediately)beginWork();else showDashboard();
        return true;
    }

    async function loadFlattenedBacklog(startImmediately = true) {
        hideStaticScreens();
        hide(el('stopWorkingBtn'));
        const container = clearDynamic();
        container.textContent = 'Loading saved tasks…';

        try {
            const tree = await loadTree();
            window.currentWorkProjectContext=null;
            sortedTasks = flattenTree(tree);
            activeTaskId = firstIncompleteTask()?.id || null;

            if (!sortedTasks.length) {
                alert('No unfinished saved tasks were found.');
                showWorkChoice();
                return;
            }

            if (await orderSelectedWork(tree) === false) return;
            await window.FocusDurability.prepare();
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
        const review=document.createElement('button');review.id='reviewExistingQueue';review.textContent='Review queue before starting';review.onclick=()=>loadFlattenedBacklog(false);list.appendChild(review);

        const roots = (workTreeCache || []).filter(node=>node.status!=='cancelled');
        const projects = roots.filter(isProjectLike);
        projects.forEach(project => {
            const stats = leafStats(project);
            const button = document.createElement('button');
            button.textContent = `${project.name} — ${stats.parts} part${stats.parts === 1 ? '' : 's'} • ${stats.ms==null?'Unestimated':minutes(stats.ms)+' min'}`;
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
        screen.append(heading, note, sortingChoice(), list, back);
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
        meta.textContent = `Total parts: ${stats.parts}. Total estimated time: ${minutes(node.estimated_ms)} minutes. Completed: ${node.progress?.completedTasks||0}. Remaining estimate: ${stats.ms==null?'Unestimated':minutes(stats.ms)+' minutes'}.`;
        screen.append(heading, meta);

        const directChildren = (node.children || []).filter(child=>child.status!=='cancelled');
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
            details.textContent = `${substats.parts} part${substats.parts === 1 ? '' : 's'} • ${substats.ms==null?'Unestimated':minutes(substats.ms)+' min'}`;
            row.append(link, details);
            list.appendChild(row);
        });
        screen.appendChild(list);

        const controls = document.createElement('div');
        controls.className = 'planner-choice-grid';
        const start = document.createElement('button');
        start.textContent = 'Start This Project';
        start.disabled = !flattenTree([node]).length;
        if(start.disabled){const reason=document.createElement('p');reason.textContent='No unfinished tasks in this project. You can still manage and edit its history.';screen.appendChild(reason);}
        start.onclick = () => startNodes([node]).catch(() => {});
        const manage = document.createElement('button');
        manage.textContent = 'Manage';
        manage.onclick = () => window.ProjectEditor.open(node.id, { origin: async()=>{await loadTree();showProjectOverview(node.id,false);} });
        const review=document.createElement('button');review.textContent='Review this project’s queue';review.disabled=start.disabled;review.onclick=()=>startNodes([node],false).catch(()=>{});
        controls.append(sortingChoice(), start, review, manage);
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
    async function resumeSelection() {
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
    }
    window.WorkPlanner = { resume: resumeSelection };

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
            row.projectRootId = task.projectRootId || task.id;
        });
        return payload;
    };
})();
