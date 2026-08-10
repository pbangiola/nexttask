const Database = require('better-sqlite3');
const path = require('path');

const dataDir = process.env.RAILWAY_VOLUME_MOUNT_PATH || __dirname;
const dbPath = path.join(dataDir, 'task_sorter.db');
const db = new Database(dbPath);
db.pragma('foreign_keys = ON');

const TASK_SCHEMA_VERSION = 2;

db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        updated_at INTEGER NOT NULL,
        total_available_time_ms INTEGER NOT NULL DEFAULT 0,
        end_constraint TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        user_id TEXT,
        parent_id TEXT,
        project_id TEXT,
        node_type TEXT NOT NULL DEFAULT 'task'
            CHECK(node_type IN ('task', 'project')),
        independently_actionable INTEGER NOT NULL DEFAULT 1
            CHECK(independently_actionable IN (0, 1)),
        name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending'
            CHECK(status IN ('pending', 'active', 'blocked', 'completed', 'cancelled')),
        estimated_ms INTEGER NOT NULL DEFAULT 0,
        elapsed_ms INTEGER NOT NULL DEFAULT 0,
        position INTEGER NOT NULL DEFAULT 0,
        blocked_by_task_id TEXT,
        created INTEGER NOT NULL,
        started INTEGER,
        completed INTEGER,
        last_changed INTEGER,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE,
        FOREIGN KEY(parent_id) REFERENCES tasks(id) ON DELETE SET NULL,
        FOREIGN KEY(blocked_by_task_id) REFERENCES tasks(id) ON DELETE SET NULL
    );
`);

for (const table of ['completed_tasks', 'task_queue']) {
    db.exec(`DROP TABLE IF EXISTS ${table};`);
}

function getColumns(tableName) {
    return db.prepare(`PRAGMA table_info(${tableName})`).all().map(column => column.name);
}

function addColumnIfMissing(tableName, columnName, definition) {
    const columns = getColumns(tableName);
    if (!columns.includes(columnName)) {
        db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition};`);
    }
}

// Additive task-node migration. Existing Task Sorter rows remain root task nodes.
// project_id is retained for compatibility with older deployments, but parent_id
// is the canonical hierarchy relationship going forward.
addColumnIfMissing('tasks', 'user_id', 'TEXT');
addColumnIfMissing('tasks', 'parent_id', 'TEXT REFERENCES tasks(id) ON DELETE SET NULL');
addColumnIfMissing('tasks', 'project_id', 'TEXT');
addColumnIfMissing('tasks', 'node_type', "TEXT NOT NULL DEFAULT 'task' CHECK(node_type IN ('task', 'project'))");
addColumnIfMissing('tasks', 'independently_actionable', 'INTEGER NOT NULL DEFAULT 1 CHECK(independently_actionable IN (0, 1))');

// Existing project_id values represented an early project relationship. Preserve
// them by copying to parent_id only where a parent has not already been assigned.
db.exec(`
    UPDATE tasks
    SET parent_id = project_id
    WHERE parent_id IS NULL
      AND project_id IS NOT NULL
      AND project_id != '';
`);

// Create indexes only after migrations have guaranteed the indexed columns exist.
db.exec(`
    CREATE INDEX IF NOT EXISTS idx_tasks_session_position
        ON tasks(session_id, position);

    CREATE INDEX IF NOT EXISTS idx_tasks_session_status
        ON tasks(session_id, status);

    CREATE INDEX IF NOT EXISTS idx_tasks_parent_position
        ON tasks(parent_id, position);

    CREATE INDEX IF NOT EXISTS idx_tasks_user_parent_position
        ON tasks(user_id, parent_id, position);
`);

db.prepare(`
    INSERT OR IGNORE INTO schema_migrations (version, applied_at)
    VALUES (?, ?)
`).run(TASK_SCHEMA_VERSION, Date.now());

const ensureSessionStmt = db.prepare(`
    INSERT INTO sessions (id, updated_at, total_available_time_ms, end_constraint)
    VALUES (@id, @updated_at, @total_available_time_ms, @end_constraint)
    ON CONFLICT(id) DO UPDATE SET
        updated_at = excluded.updated_at,
        total_available_time_ms = excluded.total_available_time_ms,
        end_constraint = excluded.end_constraint
`);

const getSessionStmt = db.prepare(`SELECT * FROM sessions WHERE id = ?`);
const getTasksStmt = db.prepare(`
    SELECT * FROM tasks
    WHERE session_id = ?
      AND (? = 0 OR status NOT IN ('completed', 'cancelled'))
    ORDER BY position ASC, created ASC
`);
const getTaskStmt = db.prepare(`SELECT * FROM tasks WHERE session_id = ? AND id = ?`);

const upsertTaskStmt = db.prepare(`
    INSERT INTO tasks (
        id, session_id, user_id, parent_id, project_id, node_type, independently_actionable,
        name, status, estimated_ms, elapsed_ms, position, blocked_by_task_id,
        created, started, completed, last_changed, updated_at
    ) VALUES (
        @id, @session_id, @user_id, @parent_id, @project_id, @node_type, @independently_actionable,
        @name, @status, @estimated_ms, @elapsed_ms, @position, @blocked_by_task_id,
        @created, @started, @completed, @last_changed, @updated_at
    )
    ON CONFLICT(id) DO UPDATE SET
        session_id = excluded.session_id,
        user_id = COALESCE(excluded.user_id, tasks.user_id),
        parent_id = excluded.parent_id,
        project_id = excluded.project_id,
        node_type = excluded.node_type,
        independently_actionable = excluded.independently_actionable,
        name = excluded.name,
        status = excluded.status,
        estimated_ms = excluded.estimated_ms,
        elapsed_ms = excluded.elapsed_ms,
        position = excluded.position,
        blocked_by_task_id = excluded.blocked_by_task_id,
        started = excluded.started,
        completed = excluded.completed,
        last_changed = excluded.last_changed,
        updated_at = excluded.updated_at
`);

function normalizeTask(sessionId, task, position) {
    const now = Date.now();
    const completedTime = task.completedTime ?? task.completedAt
        ?? (typeof task.completed === 'number' ? task.completed : null);
    const status = task.completed === true || completedTime
        ? 'completed'
        : (task.status || 'pending');
    const parentId = task.parentId ?? task.parent_id ?? task.projectId ?? task.project_id ?? null;
    const nodeType = task.nodeType ?? task.node_type ?? (task.isProject ? 'project' : 'task');
    const independentlyActionable = task.independentlyActionable
        ?? task.independently_actionable
        ?? task.severable
        ?? true;

    return {
        id: String(task.id),
        session_id: sessionId,
        user_id: task.userId ?? task.user_id ?? null,
        parent_id: parentId,
        project_id: task.projectId ?? task.project_id ?? parentId,
        node_type: nodeType === 'project' ? 'project' : 'task',
        independently_actionable: independentlyActionable ? 1 : 0,
        name: String(task.name || '').trim(),
        status,
        estimated_ms: Math.max(0, Number(task.estimatedTimeMs ?? task.estimatedMs ?? 0)),
        elapsed_ms: Math.max(0, Number(task.actualTimeMs ?? task.elapsedMs ?? 0)),
        position: Number(task.position ?? position),
        blocked_by_task_id: task.blockedByTaskId ?? task.blocked_by_task_id ?? null,
        created: Number(task.created ?? task.createdAt ?? now),
        started: task.started ?? task.startedAt ?? null,
        completed: completedTime || null,
        last_changed: task.lastChanged ?? task.last_changed ?? null,
        updated_at: now
    };
}

const replaceTaskList = db.transaction((sessionId, tasks, session) => {
    ensureSessionStmt.run({
        id: sessionId,
        updated_at: Date.now(),
        total_available_time_ms: Number(session.totalAvailableTimeMs || 0),
        end_constraint: String(session.endConstraint || '')
    });

    tasks.forEach((task, index) => {
        const row = normalizeTask(sessionId, task, index + 1);
        if (!row.id || !row.name) throw new Error('Every task requires an id and name');
        upsertTaskStmt.run(row);
    });
});

module.exports = {
    ensureSession(sessionId, session = {}) {
        ensureSessionStmt.run({
            id: sessionId,
            updated_at: Date.now(),
            total_available_time_ms: Number(session.totalAvailableTimeMs || 0),
            end_constraint: String(session.endConstraint || '')
        });
        return getSessionStmt.get(sessionId);
    },

    getSession(sessionId) {
        return getSessionStmt.get(sessionId) || null;
    },

    saveTaskList(sessionId, tasks, session = {}) {
        replaceTaskList(sessionId, tasks, session);
        return getTasksStmt.all(sessionId, 0);
    },

    getTasks(sessionId, incompleteOnly = false) {
        return getTasksStmt.all(sessionId, incompleteOnly ? 1 : 0);
    },

    getTask(sessionId, taskId) {
        return getTaskStmt.get(sessionId, taskId) || null;
    },

    getStats(sessionId) {
        return db.prepare(`
            SELECT
                COUNT(*) AS total_tasks_completed,
                COALESCE(SUM(estimated_ms), 0) AS total_estimated_ms,
                COALESCE(SUM(elapsed_ms), 0) AS total_actual_ms,
                COALESCE(SUM(estimated_ms - elapsed_ms), 0) AS total_variance_ms,
                COALESCE(AVG(estimated_ms - elapsed_ms), 0) AS avg_variance_ms
            FROM tasks
            WHERE session_id = ? AND status = 'completed'
        `).get(sessionId);
    }
};
