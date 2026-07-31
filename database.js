const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'task_sorter.db'));

// Initialize schema
db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        updated_at INTEGER NOT `+`NULL,
        state_json TEXT NOT NULL
    );
`);

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
    }
};
