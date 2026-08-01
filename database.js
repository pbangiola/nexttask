const Database = require('better-sqlite3');
const path = require('path');

const dbPath = process.env.RAILWAY_VOLUME_MOUNT_PATH
    ? path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, 'task_sorter.db')
    : path.join(__dirname, 'task_sorter.db');

const db = new Database(dbPath);

// Initialize Tables
db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
        session_id TEXT PRIMARY KEY,
        state_json TEXT NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS task_queue (
        session_id TEXT NOT NULL,
        task_name TEXT NOT NULL,
        estimated_minutes INTEGER DEFAULT 0,
        position INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS completed_tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        task_name TEXT NOT NULL,
        estimated_minutes INTEGER,
        actual_time_ms INTEGER,
        completed_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_queue_session ON task_queue(session_id, position);
`);

module.exports = {
    saveSession(sessionId, state) {
        const stmt = db.prepare(`
            INSERT INTO sessions (session_id, state_json, updated_at)
            VALUES (?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(session_id) DO UPDATE SET
                state_json = excluded.state_json,
                updated_at = CURRENT_TIMESTAMP
        `);
        stmt.run(sessionId, JSON.stringify(state));
    },

    getSession(sessionId) {
        const stmt = db.prepare('SELECT state_json FROM sessions WHERE session_id = ?');
        const row = stmt.get(sessionId);
        return row ? JSON.parse(row.state_json) : null;
    },

    clearSession(sessionId) {
        db.prepare('DELETE FROM sessions WHERE session_id = ?').run(sessionId);
        db.prepare('DELETE FROM task_queue WHERE session_id = ?').run(sessionId);
    },

    getQueue(sessionId) {
        const stmt = db.prepare('SELECT task_name, estimated_minutes FROM task_queue WHERE session_id = ? ORDER BY position ASC');
        return stmt.all(sessionId);
    },

    prependToQueue(sessionId, tasks) {
        const shiftStmt = db.prepare('UPDATE task_queue SET position = position + ? WHERE session_id = ?');
        const insertStmt = db.prepare('INSERT INTO task_queue (session_id, task_name, estimated_minutes, position) VALUES (?, ?, ?, ?)');
        
        const transaction = db.transaction((items) => {
            if (items.length === 0) return;
            shiftStmt.run(items.length, sessionId);
            items.forEach((task, idx) => {
                const name = typeof task === 'string' ? task : task.name;
                const est = task.estimatedTime || 0;
                insertStmt.run(sessionId, name, est, idx);
            });
        });
        transaction(tasks);
    },

    logCompletedTask(sessionId, taskName, estimatedMinutes, actualTimeMs) {
        const stmt = db.prepare(`
            INSERT INTO completed_tasks (session_id, task_name, estimated_minutes, actual_time_ms)
            VALUES (?, ?, ?, ?)
        `);
        stmt.run(sessionId, taskName, estimatedMinutes, actualTimeMs);
        
        // Remove completed task from persistent queue if present
        db.prepare('DELETE FROM task_queue WHERE session_id = ? AND task_name = ?').run(sessionId, taskName);
    },

    getStats(sessionId) {
        const stmt = db.prepare('SELECT * FROM completed_tasks WHERE session_id = ? ORDER BY completed_at ASC');
        return stmt.all(sessionId);
    }
};
