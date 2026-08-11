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

// Sequence is the source of truth. A project contributes only its first
// independently-actionable unfinished leaf in sibling order.
function findEligibleLeaf(node, indexes, path = []) {
    if (!isActive(node)) return null;

    const nextPath = [...path, { id: node.id, name: node.name, node_type: node.node_type }];
    const directChildren = indexes.children.get(String(node.id)) || [];

    if (node.node_type === 'project' || directChildren.length) {
        for (const child of directChildren) {
            const candidate = findEligibleLeaf(child, indexes, nextPath);
            if (candidate) return candidate;
        }
        return null;
    }

    if (!Number(node.independently_actionable)) return null;
    return { task: node, path: nextPath };
}

module.exports = {
    getActionableCandidates(userId) {
        const uid = String(userId);
        const rows = getUserNodesStmt.all(uid);
        const indexes = buildIndexes(rows);
        const roots = sortNodes(indexes.children.get(null) || []).filter(isActive);
        const candidates = [];

        for (const root of roots) {
            const candidate = findEligibleLeaf(root, indexes, []);
            if (!candidate) continue;
            candidates.push({
                root: {
                    id: root.id,
                    name: root.name,
                    node_type: root.node_type,
                    position: root.position
                },
                task: candidate.task,
                path: candidate.path
            });
        }

        return candidates;
    }
};
