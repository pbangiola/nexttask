'use strict';

(() => {
    const MODE_KEY = 'nextTaskProjectBulkCreate';

    const el = id => document.getElementById(id);

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

    function plannerState() {
        try { return JSON.parse(localStorage.getItem('nextTaskProjectPlannerUi') || '{}'); }
        catch (_) { return {}; }
    }

    function savePlannerView(view) {
        const state = plannerState();
        state.view = view;
        localStorage.setItem('nextTaskProjectPlannerUi', JSON.stringify(state));
    }

    async function createTask(parentId, name) {
        return (await api('/nodes', {
            method: 'POST',
            body: JSON.stringify({
                id: `task_${globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2, 11)}`,
                name,
                nodeType: 'task',
                parentId,
                sessionId
            })
        })).node;
    }

    async function updatePosition(id, position) {
        return api(`/nodes/${encodeURIComponent(id)}`, {
            method: 'PUT',
            body: JSON.stringify({ position })
        });
    }

    async function existingChildren(parentId) {
        return (await api(`/nodes/${encodeURIComponent(parentId)}`)).children || [];
    }

    async function sortNodes(nodes) {
        if (nodes.length < 2) return nodes;
        clearDynamic();
        show(el('taskCompare'));
        const runId = ++sortRunId;
        const sorted = await interactiveMergeSort([...nodes], runId);
        hide(el('taskCompare'));
        return sorted;
    }

    async function finishBulkEntry() {
        const state = plannerState();
        const parentId = state.currentParentId || state.currentProjectId;
        const textarea = el('partsText');
        const skipSort = el('partsSkipSort');
        const button = el('partsContinue');
        if (!parentId || !textarea || !button) return;

        const names = resolveDuplicateTaskNames(parseTaskEntryText(textarea.value));
        if (!names.length) return alert('Please add at least one task.');

        button.disabled = true;
        try {
            const children = await existingChildren(parentId);
            const byName = new Map(children.map(child => [child.name, child]));
            const nodes = [];

            for (const name of names) {
                let node = byName.get(name);
                if (!node) node = await createTask(parentId, name);
                nodes.push(node);
            }

            const ordered = skipSort?.checked ? nodes : await sortNodes(nodes);
            for (let i = 0; i < ordered.length; i++) await updatePosition(ordered[i].id, i + 1);

            sessionStorage.removeItem(MODE_KEY);
            savePlannerView('summary');
            window.ProjectPlanner?.open?.();
        } catch (error) {
            console.error(error);
            alert(error.message || 'The project tasks could not be saved.');
            button.disabled = false;
        }
    }

    document.addEventListener('click', event => {
        const id = event.target?.id;
        if (id === 'plannerCreate' || id === 'addProject') {
            sessionStorage.setItem(MODE_KEY, '1');
        }
        if (id === 'projectBack' || id === 'projectsBack' || id === 'plannerExit') {
            sessionStorage.removeItem(MODE_KEY);
        }
    }, true);

    const observer = new MutationObserver(() => {
        if (sessionStorage.getItem(MODE_KEY) !== '1') return;
        const textarea = el('partsText');
        const button = el('partsContinue');
        if (!textarea || !button || button.dataset.bulkProjectCreate === '1') return;

        button.dataset.bulkProjectCreate = '1';
        button.textContent = 'Create Project Tasks';
        button.addEventListener('click', event => {
            event.preventDefault();
            event.stopImmediatePropagation();
            finishBulkEntry();
        }, true);
    });

    observer.observe(document.documentElement, { childList: true, subtree: true });
})();
