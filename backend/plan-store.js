'use strict';
const {randomUUID}=require('node:crypto');
const db=require('./database').connection;
const users=require('./user-store');
const integrity=require('./tree-integrity');
const domain=require('../frontend/plan-domain');
const policy=require('./plan-policy');
require('./task-graph-store');
db.exec(`
CREATE TABLE IF NOT EXISTS plan_details(
 task_id TEXT PRIMARY KEY REFERENCES tasks(id), user_id TEXT NOT NULL,
 description TEXT NOT NULL DEFAULT '',notes TEXT NOT NULL DEFAULT '',location TEXT NOT NULL DEFAULT '',
 assignee TEXT NOT NULL DEFAULT '',success_criteria TEXT NOT NULL DEFAULT '',
 earliest_start_at INTEGER,scheduled_start_at INTEGER,due_at INTEGER,deadline_at INTEGER,
 remaining_ms INTEGER,remaining_base_actual INTEGER NOT NULL DEFAULT 0,archived INTEGER NOT NULL DEFAULT 0,splittable INTEGER NOT NULL DEFAULT 1,
 recurrence_days INTEGER,recurrence_zone TEXT,recurrence_root TEXT,occurrence INTEGER NOT NULL DEFAULT 0,
 UNIQUE(recurrence_root,occurrence)
);
CREATE TABLE IF NOT EXISTS plan_tags(task_id TEXT NOT NULL REFERENCES tasks(id),tag TEXT NOT NULL,PRIMARY KEY(task_id,tag));
CREATE TABLE IF NOT EXISTS plan_dependencies(user_id TEXT NOT NULL,task_id TEXT NOT NULL REFERENCES tasks(id),prerequisite_id TEXT NOT NULL REFERENCES tasks(id),PRIMARY KEY(task_id,prerequisite_id));
CREATE TABLE IF NOT EXISTS plan_comparisons(sequence INTEGER PRIMARY KEY AUTOINCREMENT,user_id TEXT NOT NULL,higher_id TEXT NOT NULL REFERENCES tasks(id),lower_id TEXT NOT NULL REFERENCES tasks(id),created_at INTEGER NOT NULL,context TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS plan_settings(user_id TEXT PRIMARY KEY,timezone TEXT NOT NULL,reserve REAL NOT NULL DEFAULT 0.2);
CREATE TABLE IF NOT EXISTS plan_availability(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,start_at INTEGER NOT NULL,end_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS plan_revisions(user_id TEXT PRIMARY KEY,revision INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS plan_deletions(user_id TEXT NOT NULL,task_id TEXT PRIMARY KEY,snapshot TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS plan_requests(user_id TEXT NOT NULL,id TEXT NOT NULL,response TEXT NOT NULL,PRIMARY KEY(user_id,id));
`);
if(!db.pragma('table_info(plan_details)').some(c=>c.name==='remaining_base_actual'))db.exec('ALTER TABLE plan_details ADD COLUMN remaining_base_actual INTEGER NOT NULL DEFAULT 0');
db.exec(`INSERT OR IGNORE INTO plan_dependencies(user_id,task_id,prerequisite_id) SELECT t.user_id,t.id,t.blocked_by_task_id FROM tasks t JOIN tasks p ON p.id=t.blocked_by_task_id AND p.user_id=t.user_id WHERE t.user_id IS NOT NULL`);
// All legacy and new writers participate in revision checks, including Work.
for(const table of ['tasks','plan_details','plan_dependencies','plan_comparisons','plan_settings','plan_availability'])for(const op of ['INSERT','UPDATE','DELETE']) {
    const row=op==='DELETE'?'OLD':'NEW';
    db.exec(`CREATE TRIGGER IF NOT EXISTS plan_revision_${table}_${op} AFTER ${op} ON ${table} WHEN ${row}.user_id IS NOT NULL BEGIN
    INSERT INTO plan_revisions(user_id,revision) VALUES(${row}.user_id,1) ON CONFLICT(user_id) DO UPDATE SET revision=revision+1; END;`);
}
for(const op of ['INSERT','DELETE']){const row=op==='DELETE'?'OLD':'NEW';db.exec(`CREATE TRIGGER IF NOT EXISTS plan_revision_tags_${op} AFTER ${op} ON plan_tags BEGIN INSERT INTO plan_revisions(user_id,revision) SELECT user_id,1 FROM tasks WHERE id=${row}.task_id AND user_id IS NOT NULL ON CONFLICT(user_id) DO UPDATE SET revision=revision+1; END;`);}
function owned(owner,id) { return users.getNode(owner,id); }
function revision(owner){return db.prepare('SELECT revision FROM plan_revisions WHERE user_id=?').get(owner)?.revision||0;}
function integer(value,label,nullable=true){if(value==null&&nullable)return null;if(!Number.isSafeInteger(value)||value<0)throw new Error(label+' must be nonnegative integer milliseconds');return value;}
function text(value,label){if(typeof value!=='string'||value.length>20000)throw new Error('Invalid '+label);return value;}
function settings(owner){return db.prepare('SELECT * FROM plan_settings WHERE user_id=?').get(owner)||{timezone:'America/Chicago',reserve:0.2};}
function snapshot(owner,now=Date.now()){
    integrity.reconcile(owner);
    const nodes=db.prepare(`SELECT t.*,d.description,d.notes,d.location,d.assignee,d.success_criteria,d.earliest_start_at,d.scheduled_start_at,d.due_at,d.deadline_at,d.remaining_ms,d.remaining_base_actual,d.archived,d.splittable,d.recurrence_days,d.recurrence_zone,d.recurrence_root,d.occurrence
    FROM tasks t LEFT JOIN plan_details d ON d.task_id=t.id WHERE t.user_id=? ORDER BY t.position,t.created,t.id`).all(owner);
    const actual=db.prepare('SELECT task_id,SUM(CASE WHEN ended_at IS NULL THEN MAX(0,?-started_at) ELSE duration_ms END) actual FROM work_intervals WHERE user_id=? GROUP BY task_id').all(now,owner);
    const times=new Map(actual.map(r=>[r.task_id,r.actual]));
    const tags=db.prepare('SELECT pt.* FROM plan_tags pt JOIN tasks t ON t.id=pt.task_id WHERE t.user_id=?').all(owner);
    for(const n of nodes){n.actual_ms=times.get(n.id)||0;if(n.remaining_ms!=null)n.remaining_ms=Math.max(0,n.remaining_ms-Math.max(0,n.actual_ms-(n.remaining_base_actual||0)));n.splittable=n.splittable!==0;n.tags=tags.filter(t=>t.task_id===n.id).map(t=>t.tag);}
    const dependencies=db.prepare('SELECT * FROM plan_dependencies WHERE user_id=?').all(owner);
    const comparisons=db.prepare('SELECT * FROM plan_comparisons WHERE user_id=? ORDER BY sequence').all(owner);
    const windows=db.prepare('SELECT id,start_at start,end_at end FROM plan_availability WHERE user_id=? ORDER BY start_at').all(owner);
    const config=settings(owner),g=domain.graph(nodes,dependencies);
    for(const n of nodes){
        const leaves=g.leaves(n.id).map(id=>g.byId.get(id));
        const included=leaves.filter(l=>l.status!=='cancelled');
        n.progress={total:included.length,completed:included.filter(l=>l.status==='completed').length,
            actualMs:nodes.filter(candidate=>candidate.id===n.id||g.ancestors(candidate.id).some(a=>a.id===n.id)).reduce((s,l)=>s+l.actual_ms,0),estimatedMs:included.reduce((s,l)=>s+l.estimated_ms,0),
            remainingMs:included.some(l=>l.status!=='completed'&&l.remaining_ms==null&&l.estimated_ms<=0)?null:included.filter(l=>l.status!=='completed').reduce((s,l)=>s+(l.remaining_ms??Math.max(0,l.estimated_ms-l.actual_ms)),0)};
    }
    return {version:revision(owner),nodes,dependencies,comparisons,windows,settings:config,forecast:domain.plan(nodes,dependencies,comparisons,{now,windows,reserve:config.reserve})};
}
function details(owner,id,input){
    db.prepare('INSERT OR IGNORE INTO plan_details(task_id,user_id) VALUES(?,?)').run(id,owner);
    for(const key of ['description','notes','location','assignee','success_criteria'])if(key in input)db.prepare(`UPDATE plan_details SET ${key}=? WHERE task_id=? AND user_id=?`).run(text(input[key],key),id,owner);
    for(const key of ['earliest_start_at','scheduled_start_at','due_at','deadline_at','remaining_ms'])if(key in input)db.prepare(`UPDATE plan_details SET ${key}=? WHERE task_id=? AND user_id=?`).run(integer(input[key],key),id,owner);
    if('remaining_ms' in input)db.prepare('UPDATE plan_details SET remaining_base_actual=(SELECT COALESCE(SUM(duration_ms),0) FROM work_intervals WHERE task_id=? AND ended_at IS NOT NULL) WHERE task_id=?').run(id,id);
    for(const key of ['archived','splittable'])if(key in input){if(typeof input[key]!=='boolean')throw new Error(key+' must be boolean');db.prepare(`UPDATE plan_details SET ${key}=? WHERE task_id=? AND user_id=?`).run(input[key]?1:0,id,owner);}
    if('tags' in input){if(!Array.isArray(input.tags)||input.tags.length>100||input.tags.some(t=>typeof t!=='string'||t.length>100))throw new Error('Invalid tags');db.prepare('DELETE FROM plan_tags WHERE task_id=?').run(id);for(const tag of new Set(input.tags.map(t=>t.trim()).filter(Boolean)))db.prepare('INSERT INTO plan_tags VALUES(?,?)').run(id,tag);}
    if('prerequisites' in input){
        if(!Array.isArray(input.prerequisites)||input.prerequisites.length>200)throw new Error('Invalid prerequisites');
        input.prerequisites.forEach(source=>owned(owner,source));
        db.prepare('DELETE FROM plan_dependencies WHERE task_id=? AND user_id=?').run(id,owner);
        for(const source of new Set(input.prerequisites))db.prepare('INSERT INTO plan_dependencies VALUES(?,?,?)').run(owner,id,source);
    }
    if('recurrence_days' in input){
        const days=input.recurrence_days;
        if(days!==null&&(!Number.isSafeInteger(days)||days<1||days>3650))throw new Error('Recurrence must be 1–3650 calendar days');
        if(days&&owned(owner,id).node_type!=='task')throw new Error('Recurring containers are not supported; recur an executable task');
        const zone=input.recurrence_zone||settings(owner).timezone;new Intl.DateTimeFormat('en-US',{timeZone:zone});
        db.prepare('UPDATE plan_details SET recurrence_days=?,recurrence_zone=?,recurrence_root=COALESCE(recurrence_root,?) WHERE task_id=?').run(days,zone,id,id);
    }
}
function calendarShift(ms,days,zone){
    if(ms==null)return null;
    const parts=value=>Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(value).filter(p=>p.type!=='literal').map(p=>[p.type,Number(p.value)]));
    const p=parts(ms),desired=Date.UTC(p.year,p.month-1,p.day+days,p.hour,p.minute,p.second,ms%1000);
    let candidate=desired;
    for(let i=0;i<4;i++){const q=parts(candidate);const represented=Date.UTC(q.year,q.month-1,q.day,q.hour,q.minute,q.second,candidate%1000);const delta=desired-represented;if(!delta)break;candidate+=delta;}
    return candidate;
}
function materializeRecurrences(owner){
    const rows=db.prepare(`SELECT t.*,d.* FROM tasks t JOIN plan_details d ON d.task_id=t.id WHERE t.user_id=? AND t.status='completed' AND d.recurrence_days IS NOT NULL`).all(owner);
    for(const row of rows){
        const root=row.recurrence_root||row.id,next=row.occurrence+1;
        if(db.prepare('SELECT 1 FROM plan_details WHERE recurrence_root=? AND occurrence=?').get(root,next))continue;
        const id=randomUUID();
        users.createNode(owner,{id,name:row.name,parentId:row.parent_id,estimatedTimeMs:row.estimated_ms});
        details(owner,id,{description:row.description,notes:row.notes,location:row.location,assignee:row.assignee,success_criteria:row.success_criteria,
            earliest_start_at:calendarShift(row.earliest_start_at??(row.scheduled_start_at==null&&row.due_at==null&&row.deadline_at==null?row.completed:null),row.recurrence_days,row.recurrence_zone),
            scheduled_start_at:calendarShift(row.scheduled_start_at,row.recurrence_days,row.recurrence_zone),due_at:calendarShift(row.due_at,row.recurrence_days,row.recurrence_zone),deadline_at:calendarShift(row.deadline_at,row.recurrence_days,row.recurrence_zone),splittable:row.splittable!==0});
        db.prepare('UPDATE plan_details SET recurrence_days=?,recurrence_zone=?,recurrence_root=?,occurrence=? WHERE task_id=?').run(row.recurrence_days,row.recurrence_zone,root,next,id);
        db.prepare('INSERT INTO plan_tags SELECT ?,tag FROM plan_tags WHERE task_id=?').run(id,row.id);
        db.prepare('INSERT INTO plan_dependencies SELECT user_id,?,prerequisite_id FROM plan_dependencies WHERE task_id=?').run(id,row.id);
        db.prepare('INSERT INTO plan_comparisons(user_id,higher_id,lower_id,created_at,context) SELECT user_id,?,lower_id,?,context FROM plan_comparisons WHERE higher_id=? AND lower_id<>?').run(id,Date.now(),row.id,id);
    }
}
function mutate(owner,input,operation){return db.transaction(()=>{
    if(input.requestId){const prior=db.prepare('SELECT response FROM plan_requests WHERE user_id=? AND id=?').get(owner,input.requestId);if(prior)return JSON.parse(prior.response);}
    if(input.version!==undefined&&input.version!==revision(owner)){const e=new Error('The plan changed. Refresh before saving.');e.status=409;throw e;}
    const result=operation();policy.validate(owner);integrity.reconcile(owner);materializeRecurrences(owner);
    const response={...result,version:revision(owner)};
    if(input.requestId)db.prepare('INSERT INTO plan_requests VALUES(?,?,?)').run(owner,text(input.requestId,'requestId'),JSON.stringify(response));
    return response;
})();}
function update(owner,id,input){
    const current=owned(owner,id);
    if(input.status==='completed' && current.status!=='completed' && current.node_type==='task') policy.assertStart(owner,id);
    if(input.archived===true){const g=policy.validate(owner);if(g.leaves(id).some(leaf=>db.prepare('SELECT 1 FROM work_intervals WHERE task_id=? AND ended_at IS NULL').get(leaf)))throw new Error('Pause work before archiving');}
    const core={};
    for(const key of ['name','nodeType','parentId','position','status','estimatedTimeMs'])if(key in input)core[key]=input[key];
    if('position' in core)integer(core.position,'position',false);
    if('estimatedTimeMs' in core)integer(core.estimatedTimeMs,'estimate',false);
    if(current.status==='cancelled' && core.status==='pending'){users.restoreSnapshot(owner,[{...current,status:'pending',completed:null}]);delete core.status;}
    if('name' in core)text(core.name,'title');
    if(Object.keys(core).length)users.updateNode(owner,id,core);
    details(owner,id,input);return {id};
}
module.exports={
    snapshot(owner,now){return db.transaction(()=>{materializeRecurrences(owner);return snapshot(owner,now);})();},
    create(owner,input){return mutate(owner,input,()=>{
        if(!Array.isArray(input.tasks)||!input.tasks.length||input.tasks.length>300)throw new Error('Supply 1–300 tasks');
        const ids=[];
        for(const task of input.tasks){text(task.name,'title');if(task.estimatedTimeMs!==undefined)integer(task.estimatedTimeMs,'estimate',false);const id=task.id||randomUUID();if(typeof id!=='string'||id.length>200)throw new Error('Invalid task ID');users.createNode(owner,{...task,id});details(owner,id,task);ids.push(id);}return {ids};
    });},
    update(owner,id,input){return mutate(owner,input,()=>update(owner,id,input));},
    bulk(owner,input){return mutate(owner,input,()=>{
        if(!Array.isArray(input.ids)||!input.ids.length||input.ids.length>300)throw new Error('Select 1–300 tasks');
        for(const id of new Set(input.ids))update(owner,id,input.changes||{});return {ids:input.ids};
    });},
    remove(owner,id,input){return mutate(owner,input,()=>{
        owned(owner,id);const result=users.deleteNode(owner,id,'subtree');db.prepare('INSERT INTO plan_deletions VALUES(?,?,?) ON CONFLICT(task_id) DO UPDATE SET snapshot=excluded.snapshot').run(owner,id,JSON.stringify(result.undo));return {id};
    });},
    restore(owner,id,input){return mutate(owner,input,()=>{
        owned(owner,id);const saved=db.prepare('SELECT snapshot FROM plan_deletions WHERE user_id=? AND task_id=?').get(owner,id);
        if(saved)users.restoreSnapshot(owner,JSON.parse(saved.snapshot));else update(owner,id,{archived:false,status:'pending'});return {id};
    });},
    rank(owner,input){return mutate(owner,input,()=>{
        const ids=input.ids;if(!Array.isArray(ids)||ids.length<2||ids.length>1000||new Set(ids).size!==ids.length)throw new Error('Supply unique task IDs to rank');
        ids.forEach(id=>owned(owner,id));
        const stmt=db.prepare("INSERT INTO plan_comparisons(user_id,higher_id,lower_id,created_at,context) VALUES(?,?,?,?,?)"),now=Date.now();
        ids.slice(1).forEach((id,index)=>stmt.run(owner,ids[index],id,now,'backlog-sort'));return {ids};
    });},
    settings(owner,input){return mutate(owner,input,()=>{
        const zone=input.timezone||settings(owner).timezone;new Intl.DateTimeFormat('en-US',{timeZone:zone});
        if(typeof input.reserve!=='number'||input.reserve<0||input.reserve>0.8)throw new Error('Reserve must be between 0 and 80%');
        if(!Array.isArray(input.windows)||input.windows.length>500)throw new Error('Invalid availability');
        const windows=input.windows.map(w=>({start:integer(w.start,'start',false),end:integer(w.end,'end',false)}));
        if(windows.some(w=>w.end<=w.start))throw new Error('Availability end must follow start');domain.intervals(windows,0,0);
        db.prepare('INSERT INTO plan_settings VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET timezone=excluded.timezone,reserve=excluded.reserve').run(owner,zone,input.reserve);
        db.prepare('DELETE FROM plan_availability WHERE user_id=?').run(owner);
        for(const w of windows)db.prepare('INSERT INTO plan_availability VALUES(?,?,?,?)').run(randomUUID(),owner,w.start,w.end);return {saved:true};
    });},
    calendarShift,materializeRecurrences
};
