const Database = require('better-sqlite3');
const path = require('path');

const dataDir = process.env.RAILWAY_VOLUME_MOUNT_PATH || __dirname;
const dbPath = path.join(dataDir, 'task_sorter.db');
const db = new Database(dbPath);
db.pragma('foreign_keys = ON');

const getUserNodesStmt = db.prepare(`
    SELECT *
    FROM tasks
    WHERE user_id = ?
    ORDER BY parent_id, position, created;
`);

function isActive(node) {
    return node && !['completed', 'cancelled'].includes(String(node.status || '').toLowerCase());
}

function sortNodes(nodes) {
    return [...nodes].sort((a, b) =>
        (Number(a.position || 0) - Number(b.position || 0)) ||
        (Number(a.created || 0) - Number(b.created || 0))
    );
}

function buildIndexes(rows) {
    const children = new Map();
    for (const row of rows) {
        const parentId = row.parent_id == null ? null : String(row.parent_id);
        if (!children.has(parentId)) children.set(parentId, []);
        children.get(parentId).push(row);
    }
    for (const [key, value] of children.entries()) children.set(key, sortNodes(value));
    return { children };
}

function collectEligibleLeaves(node, indexes, path = [], out = []) {
    if (!isActive(node)) return out;
    const nextPath = [...path, { id: node.id, name: node.name, node_type: node.node_type }];
    const directChildren = indexes.children.get(String(node.id)) || [];

    if (node.node_type === 'project' || directChildren.length) {
        for (const child of directChildren) collectEligibleLeaves(child, indexes, nextPath, out);
        return out;
    }

    if (Number(node.independently_actionable)) out.push({ task: node, path: nextPath });
    return out;
}

function orderedEligibleLeaves(rows) {
    const indexes = buildIndexes(rows);
    const roots = sortNodes(indexes.children.get(null) || []).filter(isActive);
    const leaves = [];
    for (const root of roots) {
        const candidates = collectEligibleLeaves(root, indexes, [], []);
        for (const candidate of candidates) leaves.push({
            root: { id: root.id, name: root.name, node_type: root.node_type, position: root.position },
            task: candidate.task,
            path: candidate.path
        });
    }
    return leaves;
}

module.exports = {
    getActionableCandidates(userId) {
        const leaves = orderedEligibleLeaves(getUserNodesStmt.all(String(userId)));
        const seenRoots = new Set();
        return leaves.filter(candidate => {
            if (seenRoots.has(candidate.root.id)) return false;
            seenRoots.add(candidate.root.id);
            return true;
        });
    },

    getTimeFitPlan(userId, availableMs) {
        const limit = Math.max(0, Number(availableMs || 0));
        if (!Number.isFinite(limit) || limit <= 0) throw new Error('availableMs must be greater than zero');

        const leaves = orderedEligibleLeaves(getUserNodesStmt.all(String(userId)));
        const remainingCandidates = [...leaves];
        const selected = [];
        let remainingMs = limit;

        while (remainingMs > 0 && remainingCandidates.length) {
            const index = remainingCandidates.findIndex(candidate => {
                const estimate = Number(candidate.task.estimated_ms || 0);
                return estimate > 0 && estimate <= remainingMs;
            });
            if (index < 0) break;
            const [candidate] = remainingCandidates.splice(index, 1);
            const estimate = Number(candidate.task.estimated_ms || 0);
            selected.push(candidate);
            remainingMs -= estimate;
        }

        return {
            available_ms: limit,
            planned_ms: limit - remainingMs,
            remaining_ms: remainingMs,
            tasks: selected,
            skipped_unestimated: leaves.filter(candidate => Number(candidate.task.estimated_ms || 0) <= 0).map(candidate => candidate.task.id)
        };
    }
};
