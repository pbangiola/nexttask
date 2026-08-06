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
if (!taskColumns.includes('user_id')) {
    db.exec('ALTER TABLE tasks ADD COLUMN user_id TEXT;');
}

db.exec(`
    DROP INDEX IF EXISTS idx_tasks_user_status_order;
    CREATE INDEX IF NOT EXISTS idx_tasks_user_status_position
        ON tasks(user_id, status, position, created);
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
    ORDER BY position ASC, created ASC;
`);

const moveOpenTasksToSessionStmt = db.prepare(`
    UPDATE tasks
    SET session_id = ?, updated_at = ?
    WHERE user_id = ?
      AND status NOT IN ('completed', 'cancelled');
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
    },

    importOpenTasksIntoSession(userId, sessionId) {
        this.ensureUser(userId);
        this.claimUnownedTasks(userId);
        moveOpenTasksToSessionStmt.run(String(sessionId), Date.now(), String(userId));
        return getOpenTasksStmt.all(String(userId));
    }
};
