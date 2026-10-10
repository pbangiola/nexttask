const Database = require('better-sqlite3');
const path = require('path');

const dataDir = process.env.RAILWAY_VOLUME_MOUNT_PATH || __dirname;
const db = new Database(path.join(dataDir, 'task_sorter.db'));
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS work_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    available_ms INTEGER NOT NULL DEFAULT 0,
    hard_stop_at INTEGER,
    end_constraint TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'open'
        CHECK(status IN ('open','ended','cancelled')),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS work_session_items (
    work_session_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    rank INTEGER NOT NULL,
    added_at INTEGER NOT NULL,
    PRIMARY KEY(work_session_id, task_id),
    FOREIGN KEY(work_session_id) REFERENCES work_sessions(id) ON DELETE CASCADE,
    FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS work_intervals (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    work_session_id TEXT,
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    duration_ms INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE,
    FOREIGN KEY(work_session_id) REFERENCES work_sessions(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_work_sessions_user_status
    ON work_sessions(user_id, status, updated_at);
CREATE INDEX IF NOT EXISTS idx_work_session_items_rank
    ON work_session_items(work_session_id, rank);
CREATE INDEX IF NOT EXISTS idx_work_intervals_task_started
    ON work_intervals(task_id, started_at);
`);

const getOwnedTask = db.prepare('SELECT * FROM tasks WHERE id=? AND user_id=?');
const getSession = db.prepare('SELECT * FROM work_sessions WHERE id=? AND user_id=?');
const getItems = db.prepare(`
    SELECT i.rank, t.*
    FROM work_session_items i
    JOIN tasks t ON t.id=i.task_id
    WHERE i.work_session_id=?
    ORDER BY i.rank, i.added_at
`);
const getIntervals = db.prepare(`
    SELECT * FROM work_intervals WHERE task_id=? AND user_id=? ORDER BY started_at
`);

function requireTask(userId, taskId) {
    const task = getOwnedTask.get(String(taskId), String(userId));
    if (!task) throw new Error('Task not found');
    return task;
}
function requireSession(userId, sessionId) {
    const session = getSession.get(String(sessionId), String(userId));
    if (!session) throw new Error('Work session not found');
    return session;
}

const replaceItems = db.transaction((userId, sessionId, taskIds) => {
    const session=requireSession(userId, sessionId);
    if(session.status!=='open') throw new Error('Cannot change a closed work session');
    const ids = [...new Set((taskIds || []).map(String))];
    ids.forEach(id => { const task=requireTask(userId,id); if (task.node_type !== 'task' || task.independently_actionable !== 1 || ['completed','cancelled'].includes(task.status)) throw new Error('Queue items must be open actionable tasks'); });
    db.prepare('DELETE FROM work_session_items WHERE work_session_id=?').run(sessionId);
    const insert = db.prepare('INSERT INTO work_session_items(work_session_id,task_id,rank,added_at) VALUES(?,?,?,?)');
    const now = Date.now();
    ids.forEach((id, index) => insert.run(sessionId, id, index + 1, now));
    db.prepare('UPDATE work_sessions SET updated_at=? WHERE id=? AND user_id=?').run(now, sessionId, userId);
});

module.exports = {
    getActionableTasks(userId) { return db.prepare("SELECT * FROM tasks WHERE user_id=? AND node_type='task' AND independently_actionable=1 AND status NOT IN ('completed','cancelled') ORDER BY position,created").all(String(userId)); },
    createSession(userId, input={}) {
        const id=String(input.id||'').trim();
        if(!id) throw new Error('Work session id is required');
        const now=Date.now();
        const owner=db.prepare('SELECT user_id FROM work_sessions WHERE id=?').get(id);
        if(owner && owner.user_id!==String(userId)) throw new Error('Work session id already belongs to another user');
        db.prepare(`INSERT INTO work_sessions(id,user_id,started_at,ended_at,available_ms,hard_stop_at,end_constraint,status,created_at,updated_at)
            VALUES(@id,@user_id,@started_at,NULL,@available_ms,@hard_stop_at,@end_constraint,'open',@created_at,@updated_at)
            ON CONFLICT(id) DO UPDATE SET available_ms=excluded.available_ms,hard_stop_at=excluded.hard_stop_at,end_constraint=excluded.end_constraint,updated_at=excluded.updated_at`)
          .run({id,user_id:String(userId),started_at:Number(input.startedAt||now),available_ms:Math.max(0,Number(input.availableMs||0)),hard_stop_at:input.hardStopAt??null,end_constraint:String(input.endConstraint||''),created_at:now,updated_at:now});
        return requireSession(userId,id);
    },
    getSession(userId,id){return requireSession(userId,id);},
    getOpenSession(userId){return db.prepare("SELECT * FROM work_sessions WHERE user_id=? AND status='open' ORDER BY updated_at DESC LIMIT 1").get(String(userId))||null;},
    endSession(userId,id){requireSession(userId,id);const now=Date.now();db.transaction(()=>{db.prepare('UPDATE work_intervals SET ended_at=?,duration_ms=MAX(0,?-started_at),updated_at=? WHERE work_session_id=? AND user_id=? AND ended_at IS NULL').run(now,now,now,id,String(userId));db.prepare("UPDATE work_sessions SET status='ended',ended_at=?,updated_at=? WHERE id=? AND user_id=?").run(now,now,id,String(userId));})();return requireSession(userId,id);},
    setItems(userId,id,taskIds){replaceItems(String(userId),String(id),taskIds);return getItems.all(String(id));},
    getItems(userId,id){requireSession(userId,id);return getItems.all(String(id));},
    startInterval(userId,input={}) {
        const task=requireTask(userId,input.taskId);
        const sessionId=input.workSessionId||null;
        if(task.node_type !== 'task' || task.independently_actionable !== 1 || ['completed','cancelled'].includes(task.status)) throw new Error('Cannot time a non-actionable or closed task');
        if(sessionId) { const session=requireSession(userId,sessionId); if(session.status!=='open') throw new Error('Work session is closed'); }
        const existing=db.prepare("SELECT * FROM work_intervals WHERE user_id=? AND task_id=? AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1").get(String(userId),task.id);
        if(existing) return existing;
        const id=String(input.id||'').trim(); if(!id) throw new Error('Interval id is required');
        const now=Date.now(), requested=Number(input.startedAt); const started=Number.isFinite(requested)?Math.min(now,Math.max(0,requested)):now;
        db.prepare('INSERT INTO work_intervals(id,user_id,task_id,work_session_id,started_at,ended_at,duration_ms,created_at,updated_at) VALUES(?,?,?,?,?,NULL,0,?,?)')
          .run(id,String(userId),task.id,sessionId,started,now,now);
        return db.prepare('SELECT * FROM work_intervals WHERE id=?').get(id);
    },
    stopInterval(userId,id,endedAt=Date.now()) {
        const row=db.prepare('SELECT * FROM work_intervals WHERE id=? AND user_id=?').get(String(id),String(userId));
        if(!row) throw new Error('Work interval not found');
        if(row.ended_at) return row;
        const end=Math.max(Number(row.started_at),Math.min(Number(endedAt||Date.now()),Date.now()));
        db.prepare('UPDATE work_intervals SET ended_at=?,duration_ms=?,updated_at=? WHERE id=? AND user_id=?')
          .run(end,end-Number(row.started_at),Date.now(),String(id),String(userId));
        return db.prepare('SELECT * FROM work_intervals WHERE id=?').get(String(id));
    },
    getIntervals(userId,taskId){requireTask(userId,taskId);return getIntervals.all(String(taskId),String(userId));},
    getOpenIntervals(userId,sessionId){requireSession(userId,sessionId);return db.prepare('SELECT * FROM work_intervals WHERE user_id=? AND work_session_id=? AND ended_at IS NULL ORDER BY started_at').all(String(userId),String(sessionId));}
};
