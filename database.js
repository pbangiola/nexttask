const Database = require('better-sqlite3');
const path = require('path');

// Read from Railway persistent volume mount if available, fallback to local directory
const dataDir = process.env.RAILWAY_VOLUME_MOUNT_PATH || __dirname;
const dbPath = path.join(dataDir, 'task_sorter.db');

const db = new Database(dbPath);

// Initialize relational schema for active sessions and completed task stats
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
`);

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
    }
};
