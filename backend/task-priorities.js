'use strict';
const Database = require('better-sqlite3');
const path = require('node:path');
require('./database');
const db = new Database(path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH || __dirname, 'task_sorter.db'));
db.pragma('foreign_keys = ON');
db.exec(`CREATE TABLE IF NOT EXISTS task_priorities (
    task_id TEXT PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL, due_at INTEGER, importance_rank INTEGER,
    importance_scope TEXT NOT NULL DEFAULT 'open-actionable-tasks', updated_at INTEGER NOT NULL
); CREATE INDEX IF NOT EXISTS idx_task_priorities_owner ON task_priorities(user_id);`);
db.prepare('INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES(4,?)').run(Date.now());
const open = owner => db.prepare(`SELECT t.*,p.due_at,p.importance_rank,p.importance_scope
    FROM tasks t LEFT JOIN task_priorities p ON p.task_id=t.id AND p.user_id=t.user_id
    WHERE t.user_id=? AND t.node_type='task' AND t.independently_actionable=1
    AND t.status IN ('pending','active','blocked') ORDER BY t.position,t.created,t.id`).all(owner);
function requireOwned(owner,id) {
    const row=db.prepare("SELECT * FROM tasks WHERE id=? AND user_id=? AND node_type='task'").get(id,owner);
    if(!row) throw new Error('Task not found'); return row;
}
module.exports = {
    list(owner) {return {scope:'open-actionable-tasks',items:open(String(owner))};},
    setDue(owner,id,dueAt) {
        requireOwned(owner,id);
        if(dueAt !== null && (!Number.isSafeInteger(dueAt)||dueAt < 0)) throw new Error('dueAt must be null or a nonnegative UTC timestamp in milliseconds');
        db.prepare(`INSERT INTO task_priorities(task_id,user_id,due_at,updated_at) VALUES(?,?,?,?)
            ON CONFLICT(task_id) DO UPDATE SET due_at=excluded.due_at,updated_at=excluded.updated_at`).run(id,owner,dueAt,Date.now());
        return db.prepare('SELECT * FROM task_priorities WHERE task_id=? AND user_id=?').get(id,owner);
    },
    rank(owner,ids) {
        return db.transaction(()=>{
            if(!Array.isArray(ids)||ids.some(id=>typeof id!=='string')||new Set(ids).size!==ids.length)throw new Error('Unique taskIds are required');
            ids.forEach(id=>requireOwned(owner,id));
            const expected=open(owner).map(row=>row.id);
            if(ids.length!==expected.length || expected.some(id=>!ids.includes(id)))throw new Error('Ranking scope changed. Refresh all open actionable tasks.');
            const stmt=db.prepare(`INSERT INTO task_priorities(task_id,user_id,importance_rank,updated_at) VALUES(?,?,?,?)
                ON CONFLICT(task_id) DO UPDATE SET importance_rank=excluded.importance_rank,updated_at=excluded.updated_at`);
            ids.forEach((id,index)=>stmt.run(id,owner,index+1,Date.now()));return this.list(owner);
        })();
    }
};
