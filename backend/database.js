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

    CREATE TABLE IF NOT EXISTS data_migrations (
        name TEXT PRIMARY KEY,
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

// The legacy fresh-start reset is retired. Preserve all rows, legacy tables,
// and existing migration markers even when upgrading a pre-Clerk database.
// Anonymous ownership attribution requires a separate approved migration.

function getColumns(tableName) {
    return db.prepare(`PRAGMA table_info(${tableName})`).all().map(column => column.name);
}

function addColumnIfMissing(tableName, columnName, definition) {
    const columns = getColumns(tableName);
    if (!columns.includes(columnName)) {
        db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition};`);
    }
}

addColumnIfMissing('tasks', 'user_id', 'TEXT');
addColumnIfMissing('tasks', 'parent_id', 'TEXT REFERENCES tasks(id) ON DELETE SET NULL');
addColumnIfMissing('tasks', 'project_id', 'TEXT');
addColumnIfMissing('tasks', 'node_type', "TEXT NOT NULL DEFAULT 'task' CHECK(node_type IN ('task', 'project'))");
addColumnIfMissing('tasks', 'independently_actionable', 'INTEGER NOT NULL DEFAULT 1 CHECK(independently_actionable IN (0, 1))');

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
    WHERE session_id = ? AND user_id = ?
      AND (? = 0 OR status NOT IN ('completed', 'cancelled'))
    ORDER BY position ASC, created ASC
`);
const getTaskStmt = db.prepare(`SELECT * FROM tasks WHERE session_id = ? AND user_id = ? AND id = ?`);

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
        session_id = tasks.session_id,
        user_id = tasks.user_id,
        parent_id = tasks.parent_id,
        project_id = tasks.project_id,
        node_type = tasks.node_type,
        independently_actionable = tasks.independently_actionable,
        name = tasks.name,
        status = excluded.status,
        estimated_ms = excluded.estimated_ms,
        elapsed_ms = excluded.elapsed_ms,
        position = tasks.position,
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
    const parentId = task.parentId ?? task.parent_id ?? null;
    const nodeType = task.nodeType ?? task.node_type ?? (task.isProject ? 'project' : 'task');
    const independentlyActionable = task.independentlyActionable
        ?? task.independently_actionable
        ?? task.severable
        ?? true;

    return {
        id: String(task.id || '').trim(),
        session_id: sessionId,
        user_id: task.userId ?? task.user_id ?? null,
        parent_id: parentId,
        project_id: task.projectId ?? task.project_id ?? null,
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
        const existing = db.prepare('SELECT * FROM tasks WHERE id=?').get(row.id);
        if (row.user_id !== String(sessionId) || (existing && existing.user_id !== row.user_id)) {
            throw new Error('Task not found for this user');
        }
        // A snapshot can update work state, but never the canonical graph.
        if (existing?.node_type === 'project') return;
        // A stale browser snapshot cannot restart terminal canonical work.
        // Explicit planner edits, rather than Focus recovery, own reopening.
        if (existing && ['completed', 'cancelled'].includes(existing.status)) return;
        for (const reference of existing ? [row.blocked_by_task_id] : [row.parent_id, row.project_id, row.blocked_by_task_id]) {
            if (reference == null) continue;
            const target = db.prepare('SELECT * FROM tasks WHERE id=? AND user_id=?').get(String(reference), row.user_id);
            if (!target) throw new Error('Referenced task not found for this user');
            if (!existing && (reference === row.parent_id || reference === row.project_id) && target.node_type !== 'project') {
                throw new Error('Parent node must be a project');
            }
        }
        upsertTaskStmt.run(row);
    });

    // Main's tree-integrity reconciliation remains the owner of project rollups.
    // Do not infer empty-project or elapsed-time policy from a Focus snapshot.
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
        return getTasksStmt.all(sessionId, String(sessionId), 0);
    },

    getTasks(sessionId, incompleteOnly = false) {
        return getTasksStmt.all(sessionId, String(sessionId), incompleteOnly ? 1 : 0);
    },

    getTask(sessionId, taskId) {
        return getTaskStmt.get(sessionId, String(sessionId), taskId) || null;
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
            WHERE session_id = ? AND user_id = ? AND status = 'completed'
        `).get(sessionId, String(sessionId));
    }
};
