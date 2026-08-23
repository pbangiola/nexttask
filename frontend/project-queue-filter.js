'use strict';

(() => {
    function isOpen(node) {
        return node && !['completed', 'cancelled'].includes(String(node.status || '').toLowerCase());
    }

    function hasRemainingChildren(node) {
        return (node?.children || []).some(child => {
            if (!isOpen(child)) return false;
            if (child.node_type !== 'project') return true;
            return hasRemainingChildren(child);
        });
    }

    function findNode(nodes, id) {
        for (const node of nodes || []) {
            if (node.id === id) return node;
            const found = findNode(node.children || [], id);
            if (found) return found;
        }
        return null;
    }

    async function fetchJson(path) {
        const response = await fetch(`${API_BASE_URL}/api/users/${encodeURIComponent(userId)}${path}`);
        const body = await response.json();
        if (!response.ok) throw new Error(body?.error || `Project queue request failed (${response.status})`);
        return body;
    }

    async function filterProjectQueue() {
        const list = el('projectList');
        if (!list || list.dataset.remainingWorkFilter === 'running') return;
        list.dataset.remainingWorkFilter = 'running';

        try {
            const [rootResponse, treeResponse] = await Promise.all([
                fetchJson('/nodes'),
                fetchJson('/nodes?tree=1')
            ]);

            const roots = (rootResponse.nodes || []).filter(node =>
                node.node_type === 'project' && isOpen(node)
            );
            const tree = treeResponse.nodes || [];
            const rows = Array.from(list.querySelectorAll('.planner-project-row'));

            roots.forEach((root, index) => {
                const full = findNode(tree, root.id);
                if (!full || !hasRemainingChildren(full)) rows[index]?.remove();
            });

            const visibleRows = list.querySelectorAll('.planner-project-row').length;
            if (!visibleRows) list.innerHTML = '<p>No projects with remaining work.</p>';

            const sortButton = el('sortProjects');
            if (sortButton) sortButton.disabled = visibleRows < 2;
        } catch (error) {
            console.warn('Could not filter completed/empty projects from Project Planner:', error);
        } finally {
            list.dataset.remainingWorkFilter = 'done';
        }
    }

    const observer = new MutationObserver(() => {
        if (el('projectList')) filterProjectQueue();
    });

    observer.observe(document.documentElement, { childList: true, subtree: true });
})();
