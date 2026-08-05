const Database = require('better-sqlite3');
const path = require('path');

// Read from Railway persistent volume mount if available, fallback to local directory
const dataDir = process.env.RAILWAY_VOLUME_MOUNT_PATH || __dirname;
const dbPath = path.join(dataDir, 'task_sorter.db');

const db = new Database(dbPath);
db.pragma('foreign_keys = ON');

// Initialize relational schema for sessions, completed tasks, and persistent uncompleted task queue
db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        updated_at INTEGER NOT NULL,
        state_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS completed_tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        task_name TEXT NOT NULL,
        estimated_minutes INTEGER NOT NULL,
        actual_minutes INTEGER NOT NULL,
        variance_minutes INTEGER NOT NULL,
        completed_at INTEGER NOT NULL,
        FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS task_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        task_name TEXT NOT NULL,
        estimated_minutes INTEGER DEFAULT 0,
        elapsed_ms INTEGER DEFAULT 0,
        sort_order INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        project_id TEXT,
        name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending'
            CHECK(status IN ('pending', 'active', 'blocked', 'completed', 'cancelled')),
        estimated_ms INTEGER NOT NULL DEFAULT 0,
        elapsed_ms INTEGER NOT NULL DEFAULT 0,
        sort_order INTEGER NOT NULL DEFAULT 0,
        blocked_by_task_id TEXT,
        created_at INTEGER NOT NULL,
        started_at INTEGER,
        due_at INTEGER,
        completed_at INTEGER,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE,
        FOREIGN KEY(blocked_by_task_id) REFERENCES tasks(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_tasks_session_order
        ON tasks(session_id, status, sort_order);
`);

function rebuildIfSchemaMismatch(tableName, expectedColumns, createTableSql) {
    let existingColumns;
    try {
        existingColumns = db.prepare(`PRAGMA table_info(${tableName})`).all().map(c => c.name);
    } catch (e) {
        existingColumns = [];
    }

    const tableExists = existingColumns.length > 0;
    const hasAllColumns = expectedColumns.every(col => existingColumns.includes(col));

    if (tableExists && !hasAllColumns) {
        console.log(`[migration] Rebuilding "${tableName}" - missing columns: ${expectedColumns.filter(c => !existingColumns.includes(c)).join(', ')}`);
        db.exec(`DROP TABLE IF EXISTS ${tableName};`);
        db.exec(createTableSql);
    }
}

rebuildIfSchemaMismatch(
    'sessions',
    ['id', 'updated_at', 'state_json'],
    `CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        updated_at INTEGER NOT NULL,
        state_json TEXT NOT NULL
    );`
);

rebuildIfSchemaMismatch(
    'completed_tasks',
    ['id', 'session_id', 'task_name', 'estimated_minutes', 'actual_minutes', 'variance_minutes', 'completed_at'],
    `CREATE TABLE completed_tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        task_name TEXT NOT NULL,
        estimated_minutes INTEGER NOT NULL,
        actual_minutes INTEGER NOT NULL,
        variance_minutes INTEGER NOT NULL,
        completed_at INTEGER NOT NULL,
        FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );`
);

rebuildIfSchemaMismatch(
    'task_queue',
    ['id', 'session_id', 'task_name', 'estimated_minutes', 'elapsed_ms', 'sort_order', 'created_at'],
    `CREATE TABLE task_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        task_name TEXT NOT NULL,
        estimated_minutes INTEGER DEFAULT 0,
        elapsed_ms INTEGER DEFAULT 0,
        sort_order INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );`
);

try {
    db.exec(`ALTER TABLE task_queue ADD COLUMN elapsed_ms INTEGER DEFAULT 0;`);
} catch (e) {
    // Column already exists - safe to ignore
}

const saveSessionStmt = db.prepare(`
    INSERT INTO sessions (id, updated_at, state_json)
    VALUES (?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
        updated_at = excluded.updated_at,
        state_json = excluded.state_json;
`);

const getSessionStmt = db.prepare(`
    SELECT state_json FROM sessions WHERE id = ?;
`);

const deleteSessionStmt = db.prepare(`
    DELETE FROM sessions WHERE id = ?;
`);

const logCompletedTaskStmt = db.prepare(`
    INSERT INTO completed_tasks (session_id, task_name, estimated_minutes, actual_minutes, variance_minutes, completed_at)
    VALUES (?, ?, ?, ?, ?, ?);
`);

const getUserStatsStmt = db.prepare(`
    SELECT task_name, estimated_minutes, actual_minutes, variance_minutes, completed_at
    FROM completed_tasks
    WHERE session_id = ?
    ORDER BY completed_at DESC;
`);

const getUserAggregateStatsStmt = db.prepare(`
    SELECT
        COUNT(*) as total_tasks_completed,
        SUM(estimated_minutes) as total_estimated_minutes,
        SUM(actual_minutes) as total_actual_minutes,
        SUM(variance_minutes) as total_variance_minutes,
        AVG(variance_minutes) as avg_variance_per_task
    FROM completed_tasks
    WHERE session_id = ?;
`);

const clearTaskQueueStmt = db.prepare(`DELETE FROM task_queue WHERE session_id = ?;`);
const deleteQueuedTaskByNameStmt = db.prepare(`DELETE FROM task_queue WHERE session_id = ? AND task_name = ?;`);
const insertQueuedTaskStmt = db.prepare(`
    INSERT INTO task_queue (session_id, task_name, estimated_minutes, elapsed_ms, sort_order, created_at)
    VALUES (?, ?, ?, ?, ?, ?);
`);
const getQueuedTasksStmt = db.prepare(`
    SELECT task_name, estimated_minutes, elapsed_ms, sort_order, created_at
    FROM task_queue
    WHERE session_id = ?
    ORDER BY sort_order ASC;
`);

// Prepared statements for the canonical durable task model
const upsertTaskStmt = db.prepare(`
    INSERT INTO tasks (
        id, session_id, project_id, name, status, estimated_ms, elapsed_ms,
        sort_order, blocked_by_task_id, created_at, started_at, due_at,
        completed_at, updated_at
    ) VALUES (
        @id, @session_id, @project_id, @name, @status, @estimated_ms, @elapsed_ms,
        @sort_order, @blocked_by_task_id, @created_at, @started_at, @due_at,
        @completed_at, @updated_at
    )
    ON CONFLICT(id) DO UPDATE SET
        project_id = excluded.project_id,
        name = excluded.name,
        status = excluded.status,
        estimated_ms = excluded.estimated_ms,
        elapsed_ms = excluded.elapsed_ms,
        sort_order = excluded.sort_order,
        blocked_by_task_id = excluded.blocked_by_task_id,
        started_at = excluded.started_at,
        due_at = excluded.due_at,
        completed_at = excluded.completed_at,
        updated_at = excluded.updated_at
    WHERE tasks.session_id = excluded.session_id;
`);

const getTaskStmt = db.prepare(`SELECT * FROM tasks WHERE id = ? AND session_id = ?;`);
const getTasksStmt = db.prepare(`
    SELECT * FROM tasks
    WHERE session_id = ?
      AND (? IS NULL OR status = ?)
    ORDER BY sort_order ASC, created_at ASC;
`);
const updateTaskStmt = db.prepare(`
    UPDATE tasks SET
        project_id = @project_id,
        name = @name,
        status = @status,
        estimated_ms = @estimated_ms,
        elapsed_ms = @elapsed_ms,
        sort_order = @sort_order,
        blocked_by_task_id = @blocked_by_task_id,
        started_at = @started_at,
        due_at = @due_at,
        completed_at = @completed_at,
        updated_at = @updated_at
    WHERE id = @id AND session_id = @session_id;
`);
const maxTaskSortOrderStmt = db.prepare(`
    SELECT COALESCE(MAX(sort_order), 0) AS max_sort_order
    FROM tasks WHERE session_id = ? AND status != 'completed';
`);

module.exports = {
    saveSession: (id, state) => saveSessionStmt.run(id, Date.now(), JSON.stringify(state)),
    getSession: (id) => {
        const row = getSessionStmt.get(id);
        return row ? JSON.parse(row.state_json) : null;
    },
    deleteSession: (id) => deleteSessionStmt.run(id),
    logCompletedTask: (sessionId, taskName, estimatedMin, actualMin, completedAt) => {
        const variance = estimatedMin - actualMin;
        logCompletedTaskStmt.run(sessionId, taskName, estimatedMin, actualMin, variance, completedAt || Date.now());
    },
    getUserTaskHistory: (sessionId) => getUserStatsStmt.all(sessionId),
    getUserAggregateStats: (sessionId) => getUserAggregateStatsStmt.get(sessionId),
    saveUncompletedQueue: (sessionId, tasks) => {
        const transaction = db.transaction((id, taskList) => {
            clearTaskQueueStmt.run(id);
            const now = Date.now();
            taskList.forEach((task, index) => {
                const name = typeof task === 'string' ? task : task.name;
                const est = typeof task === 'object' && task.estimatedTime ? task.estimatedTime : 0;
                const elapsed = typeof task === 'object' && task.elapsedMs ? task.elapsedMs : 0;
                insertQueuedTaskStmt.run(id, name, est, elapsed, index + 1, now);
            });
        });
        transaction(sessionId, tasks);
    },
    removeFromQueue: (sessionId, taskName) => deleteQueuedTaskByNameStmt.run(sessionId, taskName),
    getUncompletedQueue: (sessionId) => getQueuedTasksStmt.all(sessionId),

    // Canonical task model. Existing queue/history methods remain during migration.
    upsertTask: (sessionId, task) => {
        const now = Date.now();
        const record = {
            id: String(task.id),
            session_id: sessionId,
            project_id: task.projectId ?? null,
            name: String(task.name || '').trim(),
            status: task.status || 'pending',
            estimated_ms: Number(task.estimatedMs || 0),
            elapsed_ms: Number(task.elapsedMs || 0),
            sort_order: Number(task.sortOrder || 0),
            blocked_by_task_id: task.blockedByTaskId ?? null,
            created_at: Number(task.createdAt || now),
            started_at: task.startedAt ?? null,
            due_at: task.dueAt ?? null,
            completed_at: task.completedAt ?? null,
            updated_at: now
        };
        if (!record.name) throw new Error('Task name is required');
        upsertTaskStmt.run(record);
        return getTaskStmt.get(record.id, sessionId);
    },
    getTask: (sessionId, taskId) => getTaskStmt.get(taskId, sessionId) || null,
    getTasks: (sessionId, status = null) => getTasksStmt.all(sessionId, status, status),
    updateTask: (sessionId, taskId, patch) => {
        const current = getTaskStmt.get(taskId, sessionId);
        if (!current) return null;
        const next = {
            ...current,
            id: taskId,
            session_id: sessionId,
            project_id: patch.projectId !== undefined ? patch.projectId : current.project_id,
            name: patch.name !== undefined ? String(patch.name).trim() : current.name,
            status: patch.status !== undefined ? patch.status : current.status,
            estimated_ms: patch.estimatedMs !== undefined ? Number(patch.estimatedMs) : current.estimated_ms,
            elapsed_ms: patch.elapsedMs !== undefined ? Number(patch.elapsedMs) : current.elapsed_ms,
            sort_order: patch.sortOrder !== undefined ? Number(patch.sortOrder) : current.sort_order,
            blocked_by_task_id: patch.blockedByTaskId !== undefined ? patch.blockedByTaskId : current.blocked_by_task_id,
            started_at: patch.startedAt !== undefined ? patch.startedAt : current.started_at,
            due_at: patch.dueAt !== undefined ? patch.dueAt : current.due_at,
            completed_at: patch.completedAt !== undefined ? patch.completedAt : current.completed_at,
            updated_at: Date.now()
        };
        if (!next.name) throw new Error('Task name is required');
        updateTaskStmt.run(next);
        return getTaskStmt.get(taskId, sessionId);
    },
    completeTask: (sessionId, taskId, completedAt = Date.now()) => {
        return module.exports.updateTask(sessionId, taskId, {
            status: 'completed',
            completedAt,
            blockedByTaskId: null
        });
    },
    blockAndRequeueTasks: (sessionId, blockedTaskId, blockerTask) => {
        const transaction = db.transaction(() => {
            const blockedTask = getTaskStmt.get(blockedTaskId, sessionId);
            if (!blockedTask) return null;
            const maxOrder = maxTaskSortOrderStmt.get(sessionId).max_sort_order;
            const blocker = module.exports.upsertTask(sessionId, {
                ...blockerTask,
                status: 'pending',
                sortOrder: maxOrder + 1
            });
            const blocked = module.exports.updateTask(sessionId, blockedTaskId, {
                status: 'blocked',
                blockedByTaskId: blocker.id,
                sortOrder: maxOrder + 2
            });
            return { blocker, blocked };
        });
        return transaction();
    }
};
