'use strict';

(() => {
    const DUPLICATE_THRESHOLD = 0.90;
    const PROJECT_UNDO_KEY = 'nextTaskProjectEditorUndo';

    const esc = value => String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');

    function normalizeName(value) {
        return String(value ?? '')
            .toLowerCase()
            .normalize('NFKD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9]+/g, ' ')
            .trim()
            .replace(/\s+/g, ' ');
    }

    function levenshtein(a, b) {
        if (a === b) return 0;
        if (!a.length) return b.length;
        if (!b.length) return a.length;
        const previous = Array.from({ length: b.length + 1 }, (_, i) => i);
        const current = new Array(b.length + 1);
        for (let i = 1; i <= a.length; i++) {
            current[0] = i;
            for (let j = 1; j <= b.length; j++) {
                const cost = a[i - 1] === b[j - 1] ? 0 : 1;
                current[j] = Math.min(
                    current[j - 1] + 1,
                    previous[j] + 1,
                    previous[j - 1] + cost
                );
            }
            for (let j = 0; j <= b.length; j++) previous[j] = current[j];
        }
        return previous[b.length];
    }

    function similarity(a, b) {
        const left = normalizeName(a);
        const right = normalizeName(b);
        if (!left || !right) return 0;
        if (left === right) return 1;
        const longest = Math.max(left.length, right.length);
        return 1 - (levenshtein(left, right) / longest);
    }

    function duplicatePairs(nodes) {
        const tasks = (nodes || []).filter(node => node && node.node_type !== 'project' && !['completed', 'cancelled'].includes(node.status));
        const pairs = [];
        for (let i = 0; i < tasks.length; i++) {
            for (let j = i + 1; j < tasks.length; j++) {
                const score = similarity(tasks[i].name, tasks[j].name);
                if (score >= DUPLICATE_THRESHOLD) pairs.push({ a: tasks[i], b: tasks[j], score });
            }
        }
        pairs.sort((x, y) => y.score - x.score);
        return pairs;
    }

    async function api(path, options = {}) {
        const response = await fetch(`${API_BASE_URL}/api/users/${encodeURIComponent(userId)}${path}`, {
            ...options,
            headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
        });
        let body = null;
        try { body = await response.json(); } catch (_) {}
        if (!response.ok) throw new Error(body?.error || `Duplicate review request failed (${response.status})`);
        return body;
    }

    async function rootNodes() {
        return (await api('/nodes')).nodes || [];
    }

    async function nodeWithChildren(id) {
        return api(`/nodes/${encodeURIComponent(id)}`);
    }

    async function updateNode(id, input) {
        return (await api(`/nodes/${encodeURIComponent(id)}`, {
            method: 'PUT',
            body: JSON.stringify(input)
        })).node;
    }

    async function deleteNode(id) {
        return api(`/nodes/${encodeURIComponent(id)}`, { method: 'DELETE' });
    }

    function clearForReview() {
        hideStaticScreens();
        hide(el('stopWorkingBtn'));
        hide(el('startOverBtn'));
        hide(el('taskCompare'));
        return clearDynamic();
    }

    function minutes(ms) {
        return Math.round(Number(ms || 0) / 60000);
    }

    async function reviewDuplicates(nodes, onDone) {
        const pairs = duplicatePairs(nodes);
        if (!pairs.length) return onDone();

        const live = new Map((nodes || []).map(node => [node.id, { ...node }]));
        const removed = new Set();
        let index = 0;

        async function next() {
            while (index < pairs.length && (removed.has(pairs[index].a.id) || removed.has(pairs[index].b.id))) index++;
            if (index >= pairs.length) return onDone();

            const pair = pairs[index++];
            const a = live.get(pair.a.id);
            const b = live.get(pair.b.id);
            if (!a || !b) return next();

            const container = clearForReview();
            container.innerHTML = `
                <h2>Potential Duplicate</h2>
                <p>Are these the same task?</p>
                <div class="planner-choice-grid">
                    <button disabled>${esc(a.name)}<span>${minutes(a.estimated_ms)} min estimated</span></button>
                    <button disabled>${esc(b.name)}<span>${minutes(b.estimated_ms)} min estimated</span></button>
                </div>
                <p>${Math.round(pair.score * 100)}% name match</p>
                <div class="planner-choice-grid">
                    <button id="duplicateYes">Yes — Merge Them</button>
                    <button id="duplicateNo">No — Keep Both</button>
                </div>`;

            el('duplicateNo').onclick = next;
            el('duplicateYes').onclick = async () => {
                const yes = el('duplicateYes');
                const no = el('duplicateNo');
                yes.disabled = true;
                no.disabled = true;
                try {
                    const aCreated = Number(a.created || 0);
                    const bCreated = Number(b.created || 0);
                    const older = aCreated < bCreated || (aCreated === bCreated && String(a.id) < String(b.id)) ? a : b;
                    const newer = older.id === a.id ? b : a;
                    const combinedEstimate = Number(older.estimated_ms || 0) + Number(newer.estimated_ms || 0);
                    const updated = await updateNode(older.id, { estimatedTimeMs: combinedEstimate });
                    live.set(older.id, { ...older, ...updated, estimated_ms: combinedEstimate });
                    await deleteNode(newer.id);
                    removed.add(newer.id);
                    live.delete(newer.id);
                    next();
                } catch (error) {
                    alert(error.message);
                    yes.disabled = false;
                    no.disabled = false;
                }
            };
        }

        next();
    }

    async function enhanceBacklogDeleteScreen() {
        const list = el('deleteBacklogList');
        if (!list || el('reviewBacklogDuplicates')) return;
        try {
            const items = (await rootNodes()).filter(node => node.node_type !== 'project' && !['completed', 'cancelled'].includes(node.status));
            if (!duplicatePairs(items).length) return;
            const button = document.createElement('button');
            button.id = 'reviewBacklogDuplicates';
            button.textContent = 'Review Duplicates';
            const deleteSelected = el('deleteSelectedBacklog');
            if (deleteSelected) deleteSelected.before(button);
            else list.after(button);
            button.onclick = () => reviewDuplicates(items, () => window.ProjectPlanner?.open?.());
        } catch (error) {
            console.warn('Duplicate detector could not inspect backlog:', error);
        }
    }

    async function showProjectDeleteStage(taskId) {
        try {
            const { node } = await nodeWithChildren(taskId);
            const parentId = node.parent_id;
            if (!parentId) return;
            const { children } = await nodeWithChildren(parentId);
            const tasks = children.filter(child => child.node_type !== 'project' && !['completed', 'cancelled'].includes(child.status));
            const pairs = duplicatePairs(tasks);
            const container = clearForReview();
            container.innerHTML = `
                <h2>Delete ${esc(node.name)}?</h2>
                <p>${minutes(node.estimated_ms)} min estimated</p>
                <div class="planner-choice-grid">
                    <button id="confirmProjectTaskDelete">Delete Task</button>
                    ${pairs.length ? '<button id="reviewProjectDuplicates">Review Duplicates</button>' : ''}
                </div>
                <button id="cancelProjectTaskDelete">Back</button>`;

            el('confirmProjectTaskDelete').onclick = async () => {
                const button = el('confirmProjectTaskDelete');
                button.disabled = true;
                try {
                    const result = await deleteNode(node.id);
                    localStorage.setItem(PROJECT_UNDO_KEY, JSON.stringify({ snapshot: result.undo || [], returnId: parentId }));
                    window.ProjectEditor?.open?.(parentId, { push: false });
                } catch (error) {
                    alert(error.message);
                    button.disabled = false;
                }
            };
            el('cancelProjectTaskDelete').onclick = () => window.ProjectEditor?.open?.(parentId, { push: false });
            if (el('reviewProjectDuplicates')) {
                el('reviewProjectDuplicates').onclick = () => reviewDuplicates(tasks, async () => {
                    try {
                        await nodeWithChildren(node.id);
                        showProjectDeleteStage(node.id);
                    } catch (_) {
                        window.ProjectEditor?.open?.(parentId, { push: false });
                    }
                });
            }
        } catch (error) {
            alert(error.message);
        }
    }

    document.addEventListener('click', event => {
        const button = event.target.closest?.('#projectEditorTasks .planner-order-row > button');
        if (!button || button.textContent.trim() !== 'Delete') return;
        const row = button.closest('.planner-order-row');
        const taskId = row?.querySelector('.projectEditorSelect')?.value;
        if (!taskId) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        showProjectDeleteStage(taskId);
    }, true);

    const observer = new MutationObserver(() => {
        if (el('deleteBacklogList')) enhanceBacklogDeleteScreen();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
})();
