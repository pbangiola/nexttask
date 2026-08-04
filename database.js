const Database = require('better-sqlite3');
const path = require('path');

// Read from Railway persistent volume mount if available, fallback to local directory
const dataDir = process.env.RAILWAY_VOLUME_MOUNT_PATH || __dirname;
const dbPath = path.join(dataDir, 'task_sorter.db');

const db = new Database(dbPath);

// create four tables: users, projects, tasks, and sessions
db.exec(`
 
    CREATE TABLE IF NOT EXISTS users (
        userid INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT
    );
    
    CREATE TABLE IF NOT EXISTS projects (
        projectid INTEGER PRIMARY KEY AUTOINCREMENT
        project_name TEXT NOT NULL,
        userid INTEGER NOT NULL,
        project_priority INTEGER,
        parent_project INTEGER,
        FOREIGN KEY(userid) REFERENCES users(userid) ON DELETE CASCADE
    );
    
    CREATE TABLE IF NOT EXISTS task_queue (
        taskid INTEGER PRIMARY KEY AUTOINCREMENT,
        userid INTEGER NOT NULL,
        task_name TEXT NOT NULL,
        project_id INTEGER NOT NULL, 
        estimated_minutes INTEGER DEFAULT 10,
        elapsed_ms INTEGER DEFAULT 0,
        sort_order INTEGER,
        started_at TIMESTAMP,
        due_at TIMESTAMP,
        completed_at TIMESTAMP,
        FOREIGN KEY(userid) REFERENCES users(userid) ON DELETE CASCADE,
        FOREIGN KEY(projectid) REFERENCES projects(projectid) ON DELETE CASCADE
    );
    
    CREATE TABLE IF NOT EXISTS sessions (
        sessionid TEXT PRIMARY KEY,
        userid INTEGER NOT NULL,
        session_start TIMESTAMP NOT NULL,
        hardstop TIMESTAMP,
        hardstop_reason TEXT,
        softstop TIMESTAMP,
        session_end TIMESTAMP,
        FOREIGN KEY(userid) REFERENCES users(userid) ON DELETE CASCADE
    );
`);

// --- Defensive schema migrations -------------------------------------------
// Older deployments' database files may predate columns added since. Rather
// than patching one missing-column crash at a time, each table below is
// checked against its expected column set on every boot. If anything is
// missing, the table is rebuilt from scratch. These checks are cheap and are
// no-ops once a table's schema is already correct, so they're safe to leave
// in permanently.
//
// NOTE: rebuilding drops any existing rows in the affected table. If you
// need to preserve old data, capture it (e.g. via PRAGMA table_info + a
// manual SELECT/INSERT copy) before the DROP TABLE calls below run.

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

// `sessions` predates the `id` column in some deployments. SQLite can't
// ALTER a column into becoming a PRIMARY KEY, so this always rebuilds via
// DROP + CREATE rather than ALTER TABLE.
rebuildIfSchemaMismatch(
    'sessions',
    ['id', 'updated_at', 'state_json'],
    `CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        updated_at INTEGER NOT NULL,
        state_json TEXT NOT NULL
    );`
);

// `completed_tasks` predates several columns (e.g. actual_minutes) in some
// deployments.
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

// `task_queue` - covered by the elapsed_ms ALTER TABLE below for the common
// case, but checked here too in case older deployments are missing other
// columns beyond elapsed_ms.
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

// Migration for deployments where task_queue already existed without elapsed_ms
// (kept as a fast-path; rebuildIfSchemaMismatch above already covers this case,
// but ALTER TABLE ADD COLUMN preserves existing rows, which DROP+CREATE does not).
try {
    db.exec(`ALTER TABLE task_queue ADD COLUMN elapsed_ms INTEGER DEFAULT 0;`);
} catch (e) {
    // Column already exists - safe to ignore
}

// Prepared statements for active sessions
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

// Prepared statements for user task stats & history
const logCompletedTaskStmt = db.prepare(`
    INSERT INTO completed_tasks (session_id, task_name, estimated_minutes, actual_minutes, variance_minutes, completed_at)
    VALUES (?, ?, ?, ?, ?, ?);
`);

const getUserStatsStmt = db.prepare(`
    SELECT 
        task_name, 
        estimated_minutes, 
        actual_minutes, 
        variance_minutes, 
        completed_at 
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

// Prepared statements for persistent uncompleted task queue
const clearTaskQueueStmt = db.prepare(`
    DELETE FROM task_queue WHERE session_id = ?;
`);

const deleteQueuedTaskByNameStmt = db.prepare(`
    DELETE FROM task_queue WHERE session_id = ? AND task_name = ?;
`);

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

module.exports = {
    saveSession: (id, state) => {
        saveSessionStmt.run(id, Date.now(), JSON.stringify(state));
    },
    getSession: (id) => {
        const row = getSessionStmt.get(id);
        return row ? JSON.parse(row.state_json) : null;
    },
    deleteSession: (id) => {
        deleteSessionStmt.run(id);
    },
    logCompletedTask: (sessionId, taskName, estimatedMin, actualMin, completedAt) => {
        const variance = estimatedMin - actualMin;
        logCompletedTaskStmt.run(
            sessionId, 
            taskName, 
            estimatedMin, 
            actualMin, 
            variance, 
            completedAt || Date.now()
        );
    },
    getUserTaskHistory: (sessionId) => {
        return getUserStatsStmt.all(sessionId);
    },
    getUserAggregateStats: (sessionId) => {
        return getUserAggregateStatsStmt.get(sessionId);
    },
    // Full replace: the queue always mirrors the current pending task set,
    // kept in sync continuously rather than merged/pushed at stop-time.
    saveUncompletedQueue: (sessionId, tasks) => {
        const transaction = db.transaction((id, taskList) => {
            clearTaskQueueStmt.run(id);
            const now = Date.now();
            taskList.forEach((task, index) => {
                const name = typeof task === 'string' ? task : task.name;
                const est = (typeof task === 'object' && task.estimatedTime) ? task.estimatedTime : 0;
                const elapsed = (typeof task === 'object' && task.elapsedMs) ? task.elapsedMs : 0;
                insertQueuedTaskStmt.run(id, name, est, elapsed, index + 1, now);
            });
        });
        transaction(sessionId, tasks);
    },
    // Remove a single task from the pending queue by name (called on completion)
    removeFromQueue: (sessionId, taskName) => {
        deleteQueuedTaskByNameStmt.run(sessionId, taskName);
    },
    getUncompletedQueue: (sessionId) => {
        return getQueuedTasksStmt.all(sessionId);
    }
};
