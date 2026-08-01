const Database = require('better-sqlite3');
const path = require('path');

// Read from Railway persistent volume mount if available, fallback to local directory
const dataDir = process.env.RAILWAY_VOLUME_MOUNT_PATH || __dirname;
const dbPath = path.join(dataDir, 'task_sorter.db');

const db = new Database(dbPath);

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
        sort_order INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
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

// Prepared statements for persistent uncompleted task queue
const clearTaskQueueStmt = db.prepare(`
    DELETE FROM task_queue WHERE session_id = ?;
`);

const insertQueuedTaskStmt = db.prepare(`
    INSERT INTO task_queue (session_id, task_name, estimated_minutes, sort_order, created_at)
    VALUES (?, ?, ?, ?, ?);
`);

const getQueuedTasksStmt = db.prepare(`
    SELECT task_name, estimated_minutes, sort_order, created_at
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
    // Replace current queue with new uncompleted task order (Prepend behavior handled before payload sent)
    saveUncompletedQueue: (sessionId, tasks) => {
        const transaction = db.transaction((id, taskList) => {
            clearTaskQueueStmt.run(id);
            const now = Date.now();
            taskList.forEach((task, index) => {
                const name = typeof task === 'string' ? task : task.name;
                const est = (typeof task === 'object' && task.estimatedTime) ? task.estimatedTime : 0;
                insertQueuedTaskStmt.run(id, name, est, index + 1, now);
            });
        });
        transaction(sessionId, tasks);
    },
    // Prepend uncompleted tasks in front of existing queue in database
    prependUncompletedTasks: (sessionId, uncompletedTasks) => {
        const existingQueue = getQueuedTasksStmt.all(sessionId);
        
        // Merge: new uncompleted tasks first, followed by existing queue items
        const mergedList = [];
        
        // Avoid duplicate task names if already in queue
        const existingNames = new Set(existingQueue.map(q => q.task_name));
        
        uncompletedTasks.forEach(task => {
            const name = typeof task === 'string' ? task : task.name;
            const est = (typeof task === 'object' && task.estimatedTime) ? task.estimatedTime : 0;
            mergedList.push({ name, estimatedTime: est });
        });

        existingQueue.forEach(item => {
            if (!mergedList.some(m => m.name === item.task_name)) {
                mergedList.push({ name: item.task_name, estimatedTime: item.estimated_minutes });
            }
        });

        const transaction = db.transaction((id, list) => {
            clearTaskQueueStmt.run(id);
            const now = Date.now();
            list.forEach((task, index) => {
                insertQueuedTaskStmt.run(id, task.name, task.estimatedTime || 0, index + 1, now);
            });
        });
        transaction(sessionId, mergedList);
    },
    getUncompletedQueue: (sessionId) => {
        return getQueuedTasksStmt.all(sessionId);
    }
};
