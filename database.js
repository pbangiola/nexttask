const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Ensure the target directory exists if DATA_DIR is used (e.g., Railway persistent volume)
if (process.env.DATA_DIR && !fs.existsSync(process.env.DATA_DIR)) {
  fs.mkdirSync(process.env.DATA_DIR, { recursive: true });
}

// Set up database file path
const dbPath = process.env.DATA_DIR 
  ? path.join(process.env.DATA_DIR, 'tasks.db') 
  : path.join(__dirname, 'tasks.db');

const db = new Database(dbPath);

// Enable WAL mode for better concurrency performance
db.pragma('journal_mode = WAL');

// Initial Table Creation
db.exec(`
  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    text TEXT NOT NULL,
    completed INTEGER DEFAULT 0,
    position INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Migration Guard: Check if 'position' column exists in pre-existing DBs
const columns = db.pragma("table_info(tasks)");
const hasPositionColumn = columns.some(col => col.name === 'position');

if (!hasPositionColumn) {
  db.exec("ALTER TABLE tasks ADD COLUMN position INTEGER DEFAULT 0;");
}

// Migration Guard: Check if 'updated_at' column exists
const hasUpdatedAtColumn = columns.some(col => col.name === 'updated_at');

if (!hasUpdatedAtColumn) {
  db.exec("ALTER TABLE tasks ADD COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP;");
}

module.exports = db;
