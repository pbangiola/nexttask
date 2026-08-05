const Database = require('better-sqlite3');
const path = require('path');

const dataDir = process.env.RAILWAY_VOLUME_MOUNT_PATH || __dirname;
const dbPath = path.join(dataDir, 'task_sorter.db');
const db = new Database(dbPath);
db.pragma('foreign_keys = ON');

db.exec(`
    CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
    );
`);

const taskColumns = db.prepare('PRAGMA table_info(tasks)').all().map(column => column.name);
if (!taskColumns.includes('user_id')) {
    db.exec('ALTER TABLE tasks ADD COLUMN user_id TEXT;');
}

db.exec(`
    CREATE INDEX IF NOT EXISTS idx_tasks_user_status_order
        ON tasks(user_id, status, sort_order, created_at);
`);

const ensureUserStmt = db.prepare(`
    INSERT INTO users (id, created_at, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at;
`);

const claimUnownedTasksStmt = db.prepare(`
    UPDATE tasks
    SET user_id = ?
    WHERE user_id IS NULL;
`);

const attachTaskStmt = db.prepare(`
    UPDATE tasks
    SET user_id = ?, updated_at = ?
    WHERE id = ?;
`);

const getOpenTasksStmt = db.prepare(`
    SELECT *
    FROM tasks
    WHERE user_id = ?
      AND status NOT IN ('completed', 'cancelled')
    ORDER BY sort_order ASC, created_at ASC;
`);

module.exports = {
    ensureUser(userId) {
        const now = Date.now();
        ensureUserStmt.run(String(userId), now, now);
    },

    claimUnownedTasks(userId) {
        this.ensureUser(userId);
        return claimUnownedTasksStmt.run(String(userId));
    },

    attachTask(userId, taskId) {
        this.ensureUser(userId);
        return attachTaskStmt.run(String(userId), Date.now(), String(taskId));
    },

    getOpenTasks(userId) {
        this.ensureUser(userId);
        return getOpenTasksStmt.all(String(userId));
    }
};
