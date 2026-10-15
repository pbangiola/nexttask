'use strict';
const db = require('./database').connection;
const users = require('./user-store');
db.exec(`CREATE TABLE IF NOT EXISTS task_priorities (
    task_id TEXT PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL, due_at INTEGER, importance_rank INTEGER,
    importance_scope TEXT NOT NULL DEFAULT 'open-actionable-tasks', updated_at INTEGER NOT NULL
); CREATE INDEX IF NOT EXISTS idx_task_priorities_owner ON task_priorities(user_id);`);
db.prepare('INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES(4,?)').run(Date.now());
function requireOwned(owner,id) {
    const row=db.prepare('SELECT * FROM tasks WHERE id=? AND user_id=?').get(id,owner);
    if(!row)throw new Error('Task not found');return row;
}
function scope(owner,parentId) {
    const parent=parentId==null||parentId===''?null:String(parentId);
    if(parent!==null)requireOwned(owner,parent);
    return {parent,key:JSON.stringify(['siblings',parent])};
}
function peers(owner,parentId) {
    const {parent,key}=scope(owner,parentId);
    const items=db.prepare(`SELECT t.*,p.due_at,
        CASE WHEN p.importance_scope IN (?, 'open-actionable-tasks') THEN p.importance_rank ELSE NULL END importance_rank,
        p.importance_scope FROM tasks t LEFT JOIN task_priorities p ON p.task_id=t.id AND p.user_id=t.user_id
        WHERE t.user_id=? AND t.parent_id IS ? AND t.status IN ('pending','active','blocked')
        AND (t.node_type='project' OR t.independently_actionable=1) ORDER BY t.position,t.created,t.id`).all(key,owner,parent);
    for(const item of items)if(item.node_type==='project')item.remaining_estimate_ms=item.estimated_from_children
        ?users.getProgress(owner,item.id).remainingEstimateMs
        :item.estimated_ms>0?Math.max(0,item.estimated_ms-item.elapsed_ms):null;
    return {scope:key,parentId:parent,items};
}
module.exports = {
    list(owner,parentId=null){return peers(String(owner),parentId);},
    setDue(owner,id,dueAt){
        owner=String(owner);requireOwned(owner,id);
        if(dueAt!==null&&(!Number.isSafeInteger(dueAt)||dueAt<0))throw new Error('dueAt must be null or a nonnegative UTC timestamp in milliseconds');
        db.prepare(`INSERT INTO task_priorities(task_id,user_id,due_at,updated_at) VALUES(?,?,?,?)
            ON CONFLICT(task_id) DO UPDATE SET due_at=excluded.due_at,updated_at=excluded.updated_at`).run(id,owner,dueAt,Date.now());
        return db.prepare('SELECT * FROM task_priorities WHERE task_id=? AND user_id=?').get(id,owner);
    },
    rank(owner,ids,parentId=null){
        owner=String(owner);
        return db.transaction(()=>{
            if(!Array.isArray(ids)||ids.some(id=>typeof id!=='string')||new Set(ids).size!==ids.length)throw new Error('Unique taskIds are required');
            ids.forEach(id=>requireOwned(owner,id));
            const current=peers(owner,parentId),expected=current.items.map(row=>row.id);
            if(ids.length!==expected.length||expected.some(id=>!ids.includes(id)))throw new Error('Ranking scope changed. Refresh these sibling tasks and parents.');
            const stmt=db.prepare(`INSERT INTO task_priorities(task_id,user_id,importance_rank,importance_scope,updated_at) VALUES(?,?,?,?,?)
                ON CONFLICT(task_id) DO UPDATE SET importance_rank=excluded.importance_rank,importance_scope=excluded.importance_scope,updated_at=excluded.updated_at`);
            ids.forEach((id,index)=>stmt.run(id,owner,index+1,current.scope,Date.now()));return peers(owner,parentId);
        })();
    }
};
