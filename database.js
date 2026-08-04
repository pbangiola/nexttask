const Database = require('better-sqlite3');
const path = require('path');

// Read from Railway persistent volume mount if available, fallback to local directory
const dataDir = process.env.RAILWAY_VOLUME_MOUNT_PATH || __dirname;
const dbPath = path.join(dataDir, 'task_sorter.db');

const db = new Database(dbPath);

// Enable Foreign Key constraints in SQLite
db.pragma('foreign_keys = ON');

// Definition of target schemas
const SCHEMAS = {
    users: `
        CREATE TABLE IF NOT EXISTS users (
            userid INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT,
            alias INTEGER
        );
    `,
    projects: `
        CREATE TABLE IF NOT EXISTS projects (
            projectid INTEGER PRIMARY KEY AUTOINCREMENT,
            project_name TEXT NOT NULL,
            userid INTEGER NOT NULL,
            project_priority INTEGER,
            parent_project INTEGER,
            FOREIGN KEY(userid) REFERENCES users(userid) ON DELETE CASCADE
        );
    `,
    task_queue: `
        CREATE TABLE IF NOT EXISTS task_queue (
            taskid INTEGER PRIMARY KEY AUTOINCREMENT,
            userid INTEGER NOT NULL,
            task_name TEXT NOT NULL,
            project_id INTEGER, 
            estimated_minutes INTEGER DEFAULT 10,
            elapsed_ms INTEGER DEFAULT 0,
            sort_order INTEGER,
            started_at TIMESTAMP,
            due_at TIMESTAMP,
            completed_at TIMESTAMP,
            FOREIGN KEY(userid) REFERENCES users(userid) ON DELETE CASCADE,
            FOREIGN KEY(project_id) REFERENCES projects(projectid) ON DELETE CASCADE
        );
    `,
    sessions: `
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
    `
};

// Introspect table structure dynamically
function getExistingColumns(tableName) {
    try {
        return db.prepare(`PRAGMA table_info(${tableName})`).all().map(c => c.name);
    } catch (e) {
        return [];
    }
}

// Dynamically extract column definitions from a CREATE TABLE SQL statement
function parseExpectedColumns(createSql) {
    const body = createSql.slice(createSql.indexOf('(') + 1, createSql.lastIndexOf(')'));
    const lines = body.split(',').map(l => l.trim());
    const columns = [];

    for (const line of lines) {
        // Skip table-level constraints like FOREIGN KEY or PRIMARY KEY (col1, col2)
        if (/^(FOREIGN\s+KEY|PRIMARY\s+KEY|UNIQUE|CHECK|CONSTRAINT)/i.test(line)) continue;
        const colName = line.split(/\s+/)[0];
        if (colName) columns.push(colName.replace(/["'`]/g, ''));
    }
    return columns;
}

// Safely update table structures while archiving and preserving old data
function migrateTable(tableName, createSql) {
    const existingCols = getExistingColumns(tableName);

    // Table does not exist -> Create fresh
    if (existingCols.length === 0) {
        db.exec(createSql);
        return;
    }

    const expectedCols = parseExpectedColumns(createSql);
    const missingCols = expectedCols.filter(c => !existingCols.includes(c));

    // Schema is identical -> No action required
    if (missingCols.length === 0) return;

    // Check if simple ALTER TABLE ADD COLUMN is safe (no primary key / type breaking changes)
    const extraOldCols = existingCols.filter(c => !expectedCols.includes(c));
    
    if (extraOldCols.length === 0 && missingCols.length > 0) {
        console.log(`[migration] Safe-adding columns to "${tableName}": ${missingCols.join(', ')}`);
        for (const col of missingCols) {
            try {
                db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${col};`);
            } catch (e) {
                // Fall through to full archive and copy if ALTER TABLE fails
                console.warn(`[migration] ALTER TABLE failed for ${tableName}.${col}, falling back to archive transfer.`);
                break;
            }
        }
        // Verify migration completed
        if (expectedCols.every(c => getExistingColumns(tableName).includes(c))) {
            return;
        }
    }

    // Advanced Migration: Archive old table, create target table, transfer matching columns
    console.log(`[migration] Schema mismatch for "${tableName}". Archiving old data and transferring compatible records...`);
    
    const archiveName = `_archive_${tableName}_${Date.now()}`;
    
    db.transaction(() => {
        db.exec(`ALTER TABLE ${tableName} RENAME TO ${archiveName};`);
        db.exec(createSql);

        const archiveCols = getExistingColumns(archiveName);
        const sharedCols = expectedCols.filter(c => archiveCols.includes(c));

        if (sharedCols.length > 0) {
            const colList = sharedCols.join(', ');
            console.log(`[migration] Migrating data for "${tableName}" on columns: ${colList}`);
            db.exec(`INSERT INTO ${tableName} (${colList}) SELECT ${colList} FROM ${archiveName};`);
        } else {
            console.warn(`[migration] No matching columns found between old and new "${tableName}". Data preserved in table "${archiveName}".`);
        }
    })();
}

// Run migrations across all defined schemas
for (const [tableName, createSql] of Object.entries(SCHEMAS)) {
    migrateTable(tableName, createSql);
}

// --- Prepared Statements aligned with updated relational schema ---

const saveSessionStmt = db.prepare(`
    INSERT INTO sessions (sessionid, userid, session_start, hardstop, hardstop_reason, softstop, session_end)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(sessionid) DO UPDATE SET
        userid = excluded.userid,
        session_start = excluded.session_start,
        hardstop = excluded.hardstop,
        hardstop_reason = excluded.hardstop_reason,
        softstop = excluded.softstop,
        session_end = excluded.session_end;
`);

const getSessionStmt = db.prepare(`
    SELECT * FROM sessions WHERE sessionid = ?;
`);

const deleteSessionStmt = db.prepare(`
    DELETE FROM sessions WHERE sessionid = ?;
`);

const createProjectStmt = db.prepare(`
    INSERT INTO projects (project_name, userid, project_priority, parent_project)
    VALUES (?, ?, ?, ?);
`);

const getProjectsByUserStmt = db.prepare(`
    SELECT * FROM projects WHERE userid = ? ORDER BY project_priority ASC;
`);

const insertQueuedTaskStmt = db.prepare(`
    INSERT INTO task_queue (userid, task_name, project_id, estimated_minutes, elapsed_ms, sort_order, started_at, due_at, completed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);
`);

const getTasksByUserStmt = db.prepare(`
    SELECT * FROM task_queue WHERE userid = ? AND completed_at IS NULL ORDER BY sort_order ASC;
`);

const markTaskCompletedStmt = db.prepare(`
    UPDATE task_queue SET completed_at = ? WHERE taskid = ? AND userid = ?;
`);

const getUserAggregateStatsStmt = db.prepare(`
    SELECT 
        COUNT(*) as total_tasks_completed,
        SUM(estimated_minutes) as total_estimated_minutes,
        SUM(elapsed_ms / 60000) as total_actual_minutes
    FROM task_queue 
    WHERE userid = ? AND completed_at IS NOT NULL;
`);

// --- Exported Interface ---

module.exports = {
    // Session management
    saveSession: (sessionData) => {
        saveSessionStmt.run(
            sessionData.sessionid,
            sessionData.userid,
            sessionData.session_start || Date.now(),
            sessionData.hardstop || null,
            sessionData.hardstop_reason || null,
            sessionData.softstop || null,
            sessionData.session_end || null
        );
    },
    getSession: (sessionId) => {
        return getSessionStmt.get(sessionId) || null;
    },
    deleteSession: (sessionId) => {
        deleteSessionStmt.run(sessionId);
    },

    // Project management
    createProject: (projectName, userId, priority = null, parentProject = null) => {
        const info = createProjectStmt.run(projectName, userId, priority, parentProject);
        return info.lastInsertRowid;
    },
    getUserProjects: (userId) => {
        return getProjectsByUserStmt.all(userId);
    },

    // Task Queue management
    addTask: (userId, taskName, projectId, estimatedMin = 10, elapsedMs = 0, sortOrder = 1, dueAt = null) => {
        const info = insertQueuedTaskStmt.run(userId, taskName, projectId, estimatedMin, elapsedMs, sortOrder, null, dueAt, null);
        return info.lastInsertRowid;
    },
    getUncompletedQueue: (userId) => {
        return getTasksByUserStmt.all(userId);
    },
    completeTask: (taskId, userId, completedAt = Date.now()) => {
        markTaskCompletedStmt.run(completedAt, taskId, userId);
    },
    getUserAggregateStats: (userId) => {
        return getUserAggregateStatsStmt.get(userId);
    }
};
