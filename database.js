const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, 'tasksorter.db');
const db = new Database(dbPath);

// Enable WAL mode for better concurrency performance
db.pragma('journal_mode = WAL');

// Initialize schema
db.exec(`
  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    text TEXT NOT NULL,
    completed INTEGER DEFAULT 0,
    position INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS sessions (
    session_id TEXT PRIMARY KEY,
    state TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS task_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    task_name TEXT NOT NULL,
    estimated_time INTEGER,
    actual_time_ms INTEGER,
    completed_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

module.exports = db;