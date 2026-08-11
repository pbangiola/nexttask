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

const getNodeStmt = db.prepare(`
    SELECT *
    FROM tasks
    WHERE user_id = ? AND id = ?;
`);

const setDependencyStmt = db.prepare(`
    UPDATE tasks
    SET blocked_by_task_id = ?, updated_at = ?
    WHERE user_id = ? AND id = ?;
`);

function isActive(node) {
    return node && !['completed', 'cancelled'].includes(String(node.status || '').toLowerCase());
}

function dependencySatisfied(node, byId) {
    if (!node?.blocked_by_task_id) return true;
    const blocker = byId.get(String(node.blocked_by_task_id));
    return Boolean(blocker) && String(blocker.status || '').toLowerCase() === 'completed';
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

function findEligibleLeaf(node, indexes, path = []) {
    if (!isActive(node)) return null;
    if (!dependencySatisfied(node, indexes.byId)) return null;

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

    return {
        task: node,
        path: nextPath
    };
}

function assertDependencyDoesNotCycle(userId, nodeId, blockerId) {
    if (!blockerId) return;
    const uid = String(userId);
    const targetId = String(nodeId);
    let cursorId = String(blockerId);
    const seen = new Set();

    while (cursorId) {
        if (cursorId === targetId) throw new Error('Dependency would create a cycle');
        if (seen.has(cursorId)) throw new Error('Existing dependency cycle detected');
        seen.add(cursorId);
        const cursor = getNodeStmt.get(uid, cursorId);
        if (!cursor) throw new Error(`Task node not found: ${cursorId}`);
        cursorId = cursor.blocked_by_task_id ? String(cursor.blocked_by_task_id) : '';
    }
}

module.exports = {
    setDependency(userId, nodeId, blockedByTaskId) {
        const uid = String(userId);
        const id = String(nodeId);
        const node = getNodeStmt.get(uid, id);
        if (!node) throw new Error(`Task node not found: ${id}`);

        const blockerId = blockedByTaskId == null || blockedByTaskId === '' ? null : String(blockedByTaskId);
        if (blockerId === id) throw new Error('A task cannot depend on itself');
        if (blockerId) {
            const blocker = getNodeStmt.get(uid, blockerId);
            if (!blocker) throw new Error(`Task node not found: ${blockerId}`);
            assertDependencyDoesNotCycle(uid, id, blockerId);
        }

        setDependencyStmt.run(blockerId, Date.now(), uid, id);
        return getNodeStmt.get(uid, id);
    },

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
