'use strict';
const db=require('./database').connection;
const domain=require('../frontend/plan-domain');
db.exec(`CREATE TABLE IF NOT EXISTS agenda_tasks(task_id TEXT PRIMARY KEY REFERENCES tasks(id),user_id TEXT NOT NULL,importance_rank INTEGER NOT NULL,agenda_position INTEGER NOT NULL,start_at INTEGER,end_at INTEGER,segments TEXT NOT NULL DEFAULT '[]');
CREATE INDEX IF NOT EXISTS agenda_owner ON agenda_tasks(user_id,agenda_position);
CREATE TABLE IF NOT EXISTS agenda_backlog(task_id TEXT PRIMARY KEY REFERENCES tasks(id),user_id TEXT NOT NULL,position INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS calendar_events(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,name TEXT NOT NULL,start_at INTEGER NOT NULL,end_at INTEGER NOT NULL CHECK(end_at>start_at));
CREATE TABLE IF NOT EXISTS agenda_state(user_id TEXT PRIMARY KEY,planned_at INTEGER NOT NULL);
`);
db.prepare('INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES(6,?)').run(Date.now());
for(const table of ['agenda_tasks','agenda_backlog','calendar_events'])for(const op of ['INSERT','UPDATE','DELETE']){const row=op==='DELETE'?'OLD':'NEW';db.exec(`CREATE TRIGGER IF NOT EXISTS plan_revision_${table}_${op} AFTER ${op} ON ${table} BEGIN INSERT INTO plan_revisions(user_id,revision) VALUES(${row}.user_id,1) ON CONFLICT(user_id) DO UPDATE SET revision=revision+1; END;`);}
function events(owner){return db.prepare('SELECT * FROM calendar_events WHERE user_id=? ORDER BY start_at,id').all(owner);}
function ranks(owner){return db.prepare('SELECT task_id FROM agenda_tasks WHERE user_id=? ORDER BY importance_rank').all(owner).map(row=>row.task_id);}
function read(owner){
    const state=require('./plan-store').snapshot(owner),saved=new Map(db.prepare('SELECT * FROM agenda_tasks WHERE user_id=?').all(owner).map(row=>[row.task_id,row]));
    const backlog=new Map(db.prepare('SELECT * FROM agenda_backlog WHERE user_id=?').all(owner).map(row=>[row.task_id,row.position]));
    const graph=domain.graph(state.nodes,state.dependencies),order=state.forecast.importanceOrder;
    const items=state.nodes.filter(row=>row.node_type==='task'&&row.independently_actionable!==0&&!row.archived&&!['completed','cancelled'].includes(row.status)&&!graph.ancestors(row.id).some(parent=>parent.archived||['completed','cancelled'].includes(parent.status)))
        .map(row=>({...row,...saved.get(row.id),id:row.id,due_at:row.deadline_at??row.due_at,elapsed_ms:row.actual_ms,
            estimated_ms:row.remaining_ms==null?row.estimated_ms:row.remaining_ms+row.actual_ms,
            executable:graph.blocked(row.id).length===0&&[row,...graph.ancestors(row.id)].every(n=>(n.earliest_start_at||0)<=Date.now()&&(n.scheduled_start_at||0)<=Date.now()),
            backlog_position:backlog.get(row.id)??null}));
    return {revision:state.version,items,comparisons:state.comparisons,backlog:items.filter(row=>!saved.has(row.id)||backlog.has(row.id)).sort((a,b)=>(a.backlog_position??100000+order.indexOf(a.id))-(b.backlog_position??100000+order.indexOf(b.id))),
        agenda:items.filter(row=>saved.has(row.id)).sort((a,b)=>a.agenda_position-b.agenda_position),events:events(owner)};
}
function save(owner,input){return db.transaction(()=>{
    if(input.requestId){const previous=db.prepare('SELECT response FROM plan_requests WHERE user_id=? AND id=?').get(owner,input.requestId);if(previous)return JSON.parse(previous.response);}
    const store=require('./plan-store'),before=read(owner);
    if(input.revision!==before.revision)throw new Error('Agenda changed. Reload Plan before saving.');
    const ids=before.items.map(row=>row.id);
    if(!Array.isArray(input.tasks)||input.tasks.length!==ids.length||new Set(input.tasks.map(row=>row.id)).size!==ids.length||input.tasks.some(row=>!ids.includes(row.id)))throw new Error('Task list changed. Reload Plan before saving.');
    for(const row of input.tasks){if(row.dueAt!=null&&(!Number.isSafeInteger(row.dueAt)||row.dueAt<Date.now()))throw new Error('Choose a new deadline or no deadline.');store.update(owner,row.id,{deadline_at:row.dueAt??null,due_at:null});}
    const state=store.snapshot(owner),now=Date.now(),config=state.settings;
    const forecast=domain.plan(state.nodes,state.dependencies,state.comparisons,{now,windows:state.windows,...config,importanceOrder:input.tasks.map(row=>row.id),events:events(owner)});
    db.prepare('DELETE FROM agenda_tasks WHERE user_id=?').run(owner);db.prepare('DELETE FROM agenda_backlog WHERE user_id=?').run(owner);
    const insert=db.prepare('INSERT INTO agenda_tasks VALUES(?,?,?,?,?,?,?)');
    input.tasks.forEach((row,index)=>{const slot=forecast.schedule.find(slot=>slot.id===row.id);insert.run(row.id,owner,index+1,slot?forecast.schedule.indexOf(slot)+1:forecast.schedule.length+index+1,slot?.start??null,slot?.end??null,JSON.stringify(slot?.segments||[]));});
    db.prepare('INSERT INTO agenda_state VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET planned_at=excluded.planned_at').run(owner,now);
    const response=read(owner);
    if(input.requestId)db.prepare('INSERT INTO plan_requests VALUES(?,?,?)').run(owner,input.requestId,JSON.stringify(response));
    return response;
})();}
function backlog(owner,ids){return db.transaction(()=>{
    if(!Array.isArray(ids)||new Set(ids).size!==ids.length)throw new Error('Unique task IDs required');
    for(const id of ids)if(!db.prepare('SELECT 1 FROM tasks WHERE id=? AND user_id=?').get(id,owner))throw new Error('Task not found');
    const insert=db.prepare('INSERT INTO agenda_backlog VALUES(?,?,?) ON CONFLICT(task_id) DO UPDATE SET position=excluded.position');
    ids.forEach((id,index)=>insert.run(id,owner,index+1));return {saved:true};
})();}
function addEvent(owner,input){
    if(typeof input.id!=='string'||!input.id||typeof input.name!=='string'||!input.name.trim()||!Number.isSafeInteger(input.startAt)||!Number.isSafeInteger(input.endAt)||input.startAt<0||input.endAt<=input.startAt||input.endAt>8640000000000000)throw new Error('Enter an event name, start and later end time');
    const previous=db.prepare('SELECT * FROM calendar_events WHERE id=?').get(input.id);
    if(previous){if(previous.user_id!==owner||previous.name!==input.name.trim()||previous.start_at!==input.startAt||previous.end_at!==input.endAt)throw new Error('Event ID already exists');return read(owner);}
    db.prepare('INSERT INTO calendar_events VALUES(?,?,?,?,?)').run(input.id,owner,input.name.trim(),input.startAt,input.endAt);return read(owner);
}
function deleteEvent(owner,id){db.prepare('DELETE FROM calendar_events WHERE id=? AND user_id=?').run(id,owner);return read(owner);}
module.exports={read,save,backlog,addEvent,deleteEvent,events,ranks};
