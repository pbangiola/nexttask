const Database = require('better-sqlite3');
const crypto = require('crypto');
const path = require('path');

const dataDir = process.env.RAILWAY_VOLUME_MOUNT_PATH || __dirname;
const dbPath = path.join(dataDir, 'task_sorter.db');
const db = new Database(dbPath);
db.pragma('foreign_keys = ON');

const getNodeStmt = db.prepare(`SELECT * FROM tasks WHERE user_id = ? AND id = ?;`);
const activeChildrenStmt = db.prepare(`SELECT * FROM tasks WHERE user_id = ? AND parent_id = ? AND status NOT IN ('completed','cancelled');`);
const maxSiblingPositionStmt = db.prepare(`SELECT COALESCE(MAX(position),0) AS max_position FROM tasks WHERE user_id = ? AND parent_id IS ? AND status NOT IN ('completed','cancelled');`);
const makeProjectStmt = db.prepare(`
    UPDATE tasks SET
        node_type = 'project', independently_actionable = 0, status = 'pending',
        elapsed_ms = 0, position = ?, blocked_by_task_id = NULL,
        started = NULL, completed = NULL, last_changed = NULL, updated_at = ?
    WHERE user_id = ? AND id = ?;
`);
const insertChildStmt = db.prepare(`
    INSERT INTO tasks (
        id, session_id, user_id, parent_id, project_id, node_type, independently_actionable,
        name, status, estimated_ms, elapsed_ms, position, blocked_by_task_id,
        created, started, completed, last_changed, updated_at
    ) VALUES (
        @id, @session_id, @user_id, @parent_id, @project_id, 'task', @independently_actionable,
        @name, 'pending', @estimated_ms, @elapsed_ms, @position, NULL,
        @created, @started, NULL, NULL, @updated_at
    );
`);

function makeId(prefix) {
    return `${prefix}_${crypto.randomUUID()}`;
}

const transformTransaction = db.transaction((userId, nodeId, blockerName) => {
    const uid = String(userId);
    const id = String(nodeId);
    const node = getNodeStmt.get(uid, id);
    if (!node) throw new Error(`Task node not found: ${id}`);
    if (node.node_type === 'project' || activeChildrenStmt.all(uid, id).length) {
        throw new Error('Blocked can only restructure an executable leaf task');
    }
    if (['completed', 'cancelled'].includes(String(node.status || '').toLowerCase())) {
        throw new Error('Completed or cancelled work cannot be blocked');
    }

    const cleanBlockerName = String(blockerName || '').trim();
    if (!cleanBlockerName) throw new Error('blockerName is required');

    const now = Date.now();
    const parentId = node.parent_id ?? null;
    const endPosition = Number(maxSiblingPositionStmt.get(uid, parentId).max_position || 0) + 1;
    const blockerId = makeId('task');
    const workId = makeId('task');

    // The original node becomes the container and moves as one unit to the end of
    // its current sibling sequence. Its original executable state is copied below.
    makeProjectStmt.run(endPosition, now, uid, id);

    insertChildStmt.run({
        id: blockerId,
        session_id: node.session_id,
        user_id: uid,
        parent_id: id,
        project_id: id,
        independently_actionable: 1,
        name: cleanBlockerName,
        estimated_ms: 0,
        elapsed_ms: 0,
        position: 1,
        created: now,
        started: null,
        updated_at: now
    });

    insertChildStmt.run({
        id: workId,
        session_id: node.session_id,
        user_id: uid,
        parent_id: id,
        project_id: id,
        independently_actionable: Number(node.independently_actionable) ? 1 : 0,
        name: node.name,
        estimated_ms: Number(node.estimated_ms || 0),
        elapsed_ms: Number(node.elapsed_ms || 0),
        position: 2,
        created: Number(node.created || now),
        started: node.started ?? null,
        updated_at: now
    });

    return {
        project: getNodeStmt.get(uid, id),
        blocker: getNodeStmt.get(uid, blockerId),
        work: getNodeStmt.get(uid, workId)
    };
});

module.exports = {
    restructureBlockedTask(userId, nodeId, blockerName) {
        return transformTransaction(String(userId), String(nodeId), blockerName);
    }
};
