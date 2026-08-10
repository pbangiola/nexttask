const Database = require('better-sqlite3');
const path = require('path');

const dataDir = process.env.RAILWAY_VOLUME_MOUNT_PATH || __dirname;
const dbPath = path.join(dataDir, 'task_sorter.db');
const db = new Database(dbPath);
db.pragma('foreign_keys = ON');

function getColumns(tableName) {
    return db.prepare(`PRAGMA table_info(${tableName})`).all().map(column => column.name);
}

const existingUserColumns = getColumns('users');
const canonicalUserColumns = ['id', 'created_at', 'updated_at'];
const usersTableIsCanonical = canonicalUserColumns.every(column => existingUserColumns.includes(column));

if (existingUserColumns.length > 0 && !usersTableIsCanonical) {
    const existingUserCount = db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
    if (existingUserCount > 0) {
        throw new Error('Cannot replace incompatible users table because it contains data.');
    }
    db.exec('DROP TABLE users;');
}

db.exec(`
    CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
    );
`);

const taskColumns = getColumns('tasks');
if (!taskColumns.includes('user_id')) db.exec('ALTER TABLE tasks ADD COLUMN user_id TEXT;');
if (!taskColumns.includes('parent_id')) db.exec('ALTER TABLE tasks ADD COLUMN parent_id TEXT;');
if (!taskColumns.includes('node_type')) db.exec("ALTER TABLE tasks ADD COLUMN node_type TEXT NOT NULL DEFAULT 'task';");
if (!taskColumns.includes('independently_actionable')) db.exec('ALTER TABLE tasks ADD COLUMN independently_actionable INTEGER NOT NULL DEFAULT 1;');

db.exec(`
    DROP INDEX IF EXISTS idx_tasks_user_status_order;
    CREATE INDEX IF NOT EXISTS idx_tasks_user_status_position
        ON tasks(user_id, status, position, created);
    CREATE INDEX IF NOT EXISTS idx_tasks_user_parent_position
        ON tasks(user_id, parent_id, position, created);
`);

const ensureUserStmt = db.prepare(`
    INSERT INTO users (id, created_at, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at;
`);
const ensureSessionStmt = db.prepare(`
    INSERT INTO sessions (id, updated_at, total_available_time_ms, end_constraint)
    VALUES (?, ?, 0, '')
    ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at;
`);
const claimUnownedTasksStmt = db.prepare(`UPDATE tasks SET user_id = ? WHERE user_id IS NULL;`);
const attachTaskStmt = db.prepare(`UPDATE tasks SET user_id = ?, updated_at = ? WHERE id = ?;`);
const getOpenTasksStmt = db.prepare(`
    SELECT * FROM tasks
    WHERE user_id = ? AND status NOT IN ('completed', 'cancelled')
    ORDER BY position ASC, created ASC;
`);
const getOpenTaskByIdStmt = db.prepare(`
    SELECT id FROM tasks
    WHERE user_id = ? AND id = ? AND status NOT IN ('completed', 'cancelled');
`);
const updateTaskPositionStmt = db.prepare(`UPDATE tasks SET position = ?, updated_at = ? WHERE user_id = ? AND id = ?;`);
const moveOpenTasksToSessionStmt = db.prepare(`
    UPDATE tasks SET session_id = ?, updated_at = ?
    WHERE user_id = ? AND status NOT IN ('completed', 'cancelled');
`);

const getNodeStmt = db.prepare(`SELECT * FROM tasks WHERE user_id = ? AND id = ?;`);
const getRootNodesStmt = db.prepare(`
    SELECT * FROM tasks
    WHERE user_id = ? AND parent_id IS NULL AND status NOT IN ('completed', 'cancelled')
    ORDER BY position ASC, created ASC;
`);
const getChildrenStmt = db.prepare(`
    SELECT * FROM tasks
    WHERE user_id = ? AND parent_id = ? AND status NOT IN ('completed', 'cancelled')
    ORDER BY position ASC, created ASC;
`);
const getAllUserNodesStmt = db.prepare(`
    SELECT * FROM tasks WHERE user_id = ?
    ORDER BY parent_id ASC, position ASC, created ASC;
`);
const maxSiblingPositionStmt = db.prepare(`
    SELECT COALESCE(MAX(position), 0) AS max_position FROM tasks
    WHERE user_id = ? AND parent_id IS ? AND status NOT IN ('completed', 'cancelled');
`);
const insertNodeStmt = db.prepare(`
    INSERT INTO tasks (
        id, session_id, user_id, parent_id, project_id, node_type, independently_actionable,
        name, status, estimated_ms, elapsed_ms, position, blocked_by_task_id,
        created, started, completed, last_changed, updated_at
    ) VALUES (
        @id, @session_id, @user_id, @parent_id, @project_id, @node_type, @independently_actionable,
        @name, @status, @estimated_ms, @elapsed_ms, @position, @blocked_by_task_id,
        @created, @started, @completed, @last_changed, @updated_at
    );
`);
const updateNodeStmt = db.prepare(`
    UPDATE tasks SET
        parent_id = @parent_id,
        project_id = @project_id,
        node_type = @node_type,
        independently_actionable = @independently_actionable,
        name = @name,
        estimated_ms = @estimated_ms,
        position = @position,
        updated_at = @updated_at
    WHERE user_id = @user_id AND id = @id;
`);
const setNodeParentStmt = db.prepare(`
    UPDATE tasks SET parent_id = ?, project_id = ?, position = ?, updated_at = ?
    WHERE user_id = ? AND id = ?;
`);
const cancelNodeStmt = db.prepare(`
    UPDATE tasks SET status = 'cancelled', updated_at = ? WHERE user_id = ? AND id = ?;
`);

function normalizeNodeType(value) { return value === 'project' ? 'project' : 'task'; }
function normalizeActionable(value) { return value === false || value === 0 ? 0 : 1; }
function ensureSession(sessionId) {
    const normalized = String(sessionId || '').trim();
    if (!normalized) throw new Error('session id is required');
    ensureSessionStmt.run(normalized, Date.now());
    return normalized;
}
function requireNode(userId, nodeId) {
    const node = getNodeStmt.get(String(userId), String(nodeId));
    if (!node) throw new Error(`Task node not found: ${nodeId}`);
    return node;
}
function assertValidParent(userId, nodeId, parentId) {
    if (parentId == null || parentId === '') return null;
    const normalizedParentId = String(parentId);
    if (normalizedParentId === String(nodeId)) throw new Error('A node cannot be its own parent');
    const parent = requireNode(userId, normalizedParentId);
    if (parent.node_type !== 'project') throw new Error('Parent node must be a project');
    let cursor = parent;
    while (cursor?.parent_id) {
        if (String(cursor.parent_id) === String(nodeId)) throw new Error('Cannot create a project hierarchy cycle');
        cursor = getNodeStmt.get(String(userId), String(cursor.parent_id));
    }
    return normalizedParentId;
}
function nextSiblingPosition(userId, parentId) {
    return Number(maxSiblingPositionStmt.get(String(userId), parentId ?? null).max_position || 0) + 1;
}
function buildTree(rows) {
    const byId = new Map(rows.map(row => [row.id, { ...row, children: [] }]));
    const roots = [];
    for (const node of byId.values()) {
        const parent = node.parent_id ? byId.get(node.parent_id) : null;
        if (parent) parent.children.push(node);
        else roots.push(node);
    }
    const sort = nodes => {
        nodes.sort((a, b) => (a.position - b.position) || (a.created - b.created));
        nodes.forEach(node => sort(node.children));
    };
    sort(roots);
    return roots;
}

const prependOpenTasksTransaction = db.transaction((userId, taskIds) => {
    const normalizedUserId = String(userId);
    const now = Date.now();
    const requestedIds = [...new Set((taskIds || []).map(id => String(id || '').trim()).filter(Boolean))];
    requestedIds.forEach(taskId => attachTaskStmt.run(normalizedUserId, now, taskId));
    const requestedOpenIds = requestedIds.filter(taskId => Boolean(getOpenTaskByIdStmt.get(normalizedUserId, taskId)));
    const requestedOpenIdSet = new Set(requestedOpenIds);
    const olderOpenIds = getOpenTasksStmt.all(normalizedUserId).map(task => task.id).filter(id => !requestedOpenIdSet.has(id));
    [...requestedOpenIds, ...olderOpenIds].forEach((taskId, index) => updateTaskPositionStmt.run(index + 1, now, normalizedUserId, taskId));
    return requestedOpenIds.length + olderOpenIds.length;
});

const reparentTransaction = db.transaction((userId, nodeId, parentId, position) => {
    const node = requireNode(userId, nodeId);
    const normalizedParentId = assertValidParent(userId, node.id, parentId);
    const targetPosition = Number(position) > 0 ? Number(position) : nextSiblingPosition(userId, normalizedParentId);
    setNodeParentStmt.run(normalizedParentId, normalizedParentId, targetPosition, Date.now(), String(userId), node.id);
    return getNodeStmt.get(String(userId), node.id);
});

module.exports = {
    ensureUser(userId) { const now = Date.now(); ensureUserStmt.run(String(userId), now, now); },
    claimUnownedTasks(userId) { this.ensureUser(userId); return claimUnownedTasksStmt.run(String(userId)); },
    attachTask(userId, taskId) { this.ensureUser(userId); return attachTaskStmt.run(String(userId), Date.now(), String(taskId)); },
    prependOpenTasks(userId, taskIds) { this.ensureUser(userId); return prependOpenTasksTransaction(String(userId), Array.isArray(taskIds) ? taskIds : []); },
    getOpenTasks(userId) { this.ensureUser(userId); return getOpenTasksStmt.all(String(userId)); },
    importOpenTasksIntoSession(userId, sessionId) {
        this.ensureUser(userId); this.claimUnownedTasks(userId);
        const normalizedSessionId = ensureSession(sessionId);
        moveOpenTasksToSessionStmt.run(normalizedSessionId, Date.now(), String(userId));
        return getOpenTasksStmt.all(String(userId));
    },
    getRootNodes(userId) { this.ensureUser(userId); return getRootNodesStmt.all(String(userId)); },
    getChildren(userId, parentId) { this.ensureUser(userId); requireNode(userId, parentId); return getChildrenStmt.all(String(userId), String(parentId)); },
    getNode(userId, nodeId) { this.ensureUser(userId); return requireNode(userId, nodeId); },
    getTree(userId) { this.ensureUser(userId); return buildTree(getAllUserNodesStmt.all(String(userId))); },
    createNode(userId, input = {}) {
        this.ensureUser(userId);
        const id = String(input.id || '').trim();
        const name = String(input.name || '').trim();
        if (!id || !name) throw new Error('id and name are required');
        if (getNodeStmt.get(String(userId), id)) throw new Error(`Task node already exists: ${id}`);
        const parentId = assertValidParent(userId, id, input.parentId ?? input.parent_id ?? null);
        const now = Date.now();
        const position = Number(input.position) > 0 ? Number(input.position) : nextSiblingPosition(userId, parentId);
        const nodeSessionId = ensureSession(input.sessionId || input.session_id || `planner:${userId}`);
        insertNodeStmt.run({
            id, session_id: nodeSessionId, user_id: String(userId),
            parent_id: parentId, project_id: parentId, node_type: normalizeNodeType(input.nodeType ?? input.node_type),
            independently_actionable: normalizeActionable(input.independentlyActionable ?? input.independently_actionable),
            name, status: 'pending', estimated_ms: Math.max(0, Number(input.estimatedTimeMs ?? input.estimated_ms ?? 0)),
            elapsed_ms: 0, position, blocked_by_task_id: null, created: Number(input.created || now), started: null,
            completed: null, last_changed: input.lastChanged ?? now, updated_at: now
        });
        return getNodeStmt.get(String(userId), id);
    },
    updateNode(userId, nodeId, input = {}) {
        this.ensureUser(userId);
        const current = requireNode(userId, nodeId);
        const parentId = input.parentId !== undefined || input.parent_id !== undefined
            ? assertValidParent(userId, nodeId, input.parentId ?? input.parent_id)
            : current.parent_id;
        updateNodeStmt.run({
            id: current.id, user_id: String(userId), parent_id: parentId, project_id: parentId,
            node_type: normalizeNodeType(input.nodeType ?? input.node_type ?? current.node_type),
            independently_actionable: normalizeActionable(input.independentlyActionable ?? input.independently_actionable ?? current.independently_actionable),
            name: String(input.name ?? current.name).trim(),
            estimated_ms: Math.max(0, Number(input.estimatedTimeMs ?? input.estimated_ms ?? current.estimated_ms)),
            position: Number(input.position ?? current.position), updated_at: Date.now()
        });
        return requireNode(userId, nodeId);
    },
    reparentNode(userId, nodeId, parentId, position) { this.ensureUser(userId); return reparentTransaction(String(userId), String(nodeId), parentId, position); },
    cancelNode(userId, nodeId) { this.ensureUser(userId); requireNode(userId, nodeId); cancelNodeStmt.run(Date.now(), String(userId), String(nodeId)); return true; }
};
