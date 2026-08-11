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
    const byId = new Map(rows.map(row => [String(row.id), row]));
    const children = new Map();
    for (const row of rows) {
        const parentId = row.parent_id == null ? null : String(row.parent_id);
        if (!children.has(parentId)) children.set(parentId, []);
        children.get(parentId).push(row);
    }
    for (const [key, value] of children.entries()) children.set(key, sortNodes(value));
    return { byId, children };
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

function orderedEligibleLeaves(rows, rootId = null) {
    const indexes = buildIndexes(rows);
    let roots;

    if (rootId) {
        const root = indexes.byId.get(String(rootId));
        if (!root || !isActive(root) || root.node_type !== 'project') return [];
        roots = [root];
    } else {
        roots = sortNodes(indexes.children.get(null) || []).filter(isActive);
    }

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

    getTimeFitPlan(userId, availableMs, rootId = null) {
        const rawLimit = Number(availableMs || 0);
        const limited = Number.isFinite(rawLimit) && rawLimit > 0;
        const limit = limited ? rawLimit : 0;
        const leaves = orderedEligibleLeaves(getUserNodesStmt.all(String(userId)), rootId);

        if (rootId && !leaves.length) {
            const rows = getUserNodesStmt.all(String(userId));
            const project = rows.find(row => String(row.id) === String(rootId));
            if (!project || project.node_type !== 'project' || !isActive(project)) throw new Error('Project not found');
        }

        if (!limited) {
            const selected = leaves.filter(candidate => Number(candidate.task.estimated_ms || 0) > 0);
            return {
                available_ms: 0,
                planned_ms: selected.reduce((sum, candidate) => sum + Number(candidate.task.estimated_ms || 0), 0),
                remaining_ms: 0,
                tasks: selected,
                skipped_unestimated: leaves.filter(candidate => Number(candidate.task.estimated_ms || 0) <= 0).map(candidate => candidate.task.id),
                root_id: rootId || null
            };
        }

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
            skipped_unestimated: leaves.filter(candidate => Number(candidate.task.estimated_ms || 0) <= 0).map(candidate => candidate.task.id),
            root_id: rootId || null
        };
    }
};
