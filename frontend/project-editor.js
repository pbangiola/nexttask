'use strict';

// Recursive project editor. This module intentionally sits beside planner.js so the
// project-planning creation flow remains stable while existing-project editing gets
// a reusable, depth-independent UI.
window.ProjectEditor = (() => {
    const esc = value => String(value ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
    const makeId = prefix => `${prefix}_${globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2, 11)}`;
    const history = [];
    let currentId = null;

    async function api(path, options = {}) {
        const response = await fetch(`${API_BASE_URL}/api/users/${encodeURIComponent(userId)}${path}`, {
            ...options,
            headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
        });
        let body = null;
        try { body = await response.json(); } catch (_) {}
        if (!response.ok) throw new Error(body?.error || `Project request failed (${response.status})`);
        return body;
    }

    async function getNode(id) { return api(`/nodes/${encodeURIComponent(id)}`); }
    async function roots() { return (await api('/nodes')).nodes || []; }
    async function createNode(input) {
        return (await api('/nodes', {
            method: 'POST',
            body: JSON.stringify({ id: input.id || makeId(input.nodeType === 'project' ? 'project' : 'task'), ...input })
        })).node;
    }

    function shell() {
        hideStaticScreens();
        hide(el('stopWorkingBtn'));
        hide(el('startOverBtn'));
        hide(el('taskCompare'));
        return clearDynamic();
    }

    function minutes(ms) { return Math.round(Number(ms || 0) / 60000); }

    async function open(projectId, options = {}) {
        try {
            if (!projectId) return;
            if (options.push !== false && currentId && currentId !== projectId) history.push(currentId);
            currentId = projectId;
            const { node, children } = await getNode(projectId);
            if (node.node_type !== 'project') throw new Error('Only projects can be opened in the project editor.');

            const tasks = children.filter(child => child.node_type !== 'project');
            const projects = children.filter(child => child.node_type === 'project');
            const c = shell();
            c.innerHTML = `
                <h2>${esc(node.name)}</h2>
                <p>${minutes(node.estimated_ms)} min estimated</p>
                <h3>Tasks</h3>
                <div id="projectEditorTasks" class="planner-list"></div>
                <h3>Projects</h3>
                <div id="projectEditorProjects"></div>
                <div class="planner-choice-grid">
                    <button id="projectEditorAddTask">Add Task</button>
                    <button id="projectEditorAddProject">Add Subproject</button>
                </div>
                <button id="projectEditorBack">Back</button>`;

            const taskList = el('projectEditorTasks');
            if (!tasks.length) taskList.innerHTML = '<p>No loose tasks at this level.</p>';
            tasks.forEach(task => {
                const row = document.createElement('div');
                row.className = 'planner-order-row';
                row.textContent = `${task.name} — ${minutes(task.estimated_ms)} min`;
                taskList.appendChild(row);
            });

            const projectList = el('projectEditorProjects');
            if (!projects.length) projectList.innerHTML = '<p>No subprojects at this level.</p>';
            projects.forEach(project => {
                const row = document.createElement('div');
                row.className = 'planner-project-row';
                const link = document.createElement('button');
                link.className = 'planner-project-link';
                link.textContent = project.name;
                link.onclick = () => open(project.id);
                const meta = document.createElement('span');
                meta.textContent = `${minutes(project.estimated_ms)} min estimated • Click to view or edit`;
                row.append(link, meta);
                projectList.appendChild(row);
            });

            el('projectEditorAddTask').onclick = () => showAddTask(node);
            el('projectEditorAddProject').onclick = () => showAddProject(node);
            el('projectEditorBack').onclick = async () => {
                if (history.length) return open(history.pop(), { push: false });
                currentId = null;
                if (window.ProjectPlanner?.open) {
                    localStorage.setItem('nextTaskProjectPlannerUi', JSON.stringify({ view: 'projects-list' }));
                    return window.ProjectPlanner.open();
                }
            };
        } catch (error) {
            console.error(error);
            const c = shell();
            c.innerHTML = `<h2>Project Editor</h2><p>${esc(error.message || 'Could not open project.')}</p><button id="projectEditorErrorBack">Back</button>`;
            el('projectEditorErrorBack').onclick = () => history.length ? open(history.pop(), { push: false }) : window.ProjectPlanner?.open?.();
        }
    }

    function showAddTask(parent) {
        const c = shell();
        c.innerHTML = `<h2>Add Task to ${esc(parent.name)}</h2>
            <label>Task name<input id="projectEditorTaskName"></label>
            <label>Estimated time<input id="projectEditorTaskMinutes" type="number" min="1" placeholder="Minutes"></label>
            <button id="projectEditorTaskSave">Add Task</button>
            <button id="projectEditorTaskCancel">Back</button>`;
        el('projectEditorTaskSave').onclick = async () => {
            const name = el('projectEditorTaskName').value.trim();
            const mins = parseInt(el('projectEditorTaskMinutes').value, 10);
            if (!name) return alert('Please enter a task name.');
            if (!Number.isFinite(mins) || mins < 1) return alert('Please enter an estimate in minutes.');
            try {
                await createNode({ name, nodeType: 'task', parentId: parent.id, estimatedTimeMs: mins * 60000, sessionId });
                open(parent.id, { push: false });
            } catch (error) { alert(error.message); }
        };
        el('projectEditorTaskCancel').onclick = () => open(parent.id, { push: false });
    }

    function showAddProject(parent) {
        const c = shell();
        c.innerHTML = `<h2>Add Subproject to ${esc(parent.name)}</h2>
            <label>Project name<input id="projectEditorProjectName"></label>
            <label>Estimated time<input id="projectEditorProjectMinutes" type="number" min="1" placeholder="Minutes"></label>
            <button id="projectEditorProjectSave">Add Subproject</button>
            <button id="projectEditorProjectCancel">Back</button>`;
        el('projectEditorProjectSave').onclick = async () => {
            const name = el('projectEditorProjectName').value.trim();
            const mins = parseInt(el('projectEditorProjectMinutes').value, 10);
            if (!name) return alert('Please enter a project name.');
            if (!Number.isFinite(mins) || mins < 1) return alert('Please enter an estimate in minutes.');
            try {
                const child = await createNode({ name, nodeType: 'project', parentId: parent.id, estimatedTimeMs: mins * 60000, independentlyActionable: false, sessionId });
                await open(child.id);
            } catch (error) { alert(error.message); }
        };
        el('projectEditorProjectCancel').onclick = () => open(parent.id, { push: false });
    }

    // Existing-project rows are rendered inside planner.js. Capture those clicks before
    // planner.js's summary handler and route them into the recursive editor. We resolve
    // by row index rather than project name so duplicate project names remain safe.
    document.addEventListener('click', async event => {
        const link = event.target.closest?.('.planner-project-link');
        if (!link || link.closest('#projectEditorProjects')) return;
        const allLinks = Array.from(document.querySelectorAll('#projectList .planner-project-link'));
        const index = allLinks.indexOf(link);
        if (index < 0) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        try {
            const projects = (await roots()).filter(node => node.node_type === 'project' && !['completed','cancelled'].includes(node.status));
            if (projects[index]) {
                history.length = 0;
                currentId = null;
                await open(projects[index].id, { push: false });
            }
        } catch (error) { console.error('Could not open recursive project editor:', error); }
    }, true);

    return { open };
})();
