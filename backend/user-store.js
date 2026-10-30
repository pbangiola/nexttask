'use strict';
// All graph mutations and derived metrics use one connection/transaction.
const db = require('./database').connection;
const integrity = require('./tree-integrity');
const existing = db.pragma('table_info(users)').map(row=>row.name);
if (existing.length && !['id','created_at','updated_at'].every(key=>existing.includes(key))) {
    if (db.prepare('SELECT COUNT(*) n FROM users').get().n) throw new Error('Cannot replace incompatible users table because it contains data.');
    db.exec('DROP TABLE users');
}
db.exec(`CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_tasks_user_status_position ON tasks(user_id,status,position,created);
    CREATE INDEX IF NOT EXISTS idx_tasks_user_parent_position ON tasks(user_id,parent_id,position,created);`);
const openTasks=db.prepare("SELECT * FROM tasks WHERE user_id=? AND status NOT IN ('completed','cancelled') ORDER BY position,created");
const allNodes=db.prepare('SELECT * FROM tasks WHERE user_id=? ORDER BY parent_id,position,created');
const childRows=db.prepare("SELECT * FROM tasks WHERE user_id=? AND parent_id=? AND status<>'cancelled' ORDER BY position,created");
function ensureUser(owner){const now=Date.now();db.prepare('INSERT INTO users VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET updated_at=excluded.updated_at').run(String(owner),now,now);}
function requireNode(owner,id){const row=db.prepare('SELECT * FROM tasks WHERE user_id=? AND id=?').get(String(owner),String(id));if(!row)throw new Error(`Task node not found: ${id}`);return row;}
function ms(value,label='Estimate'){const n=Number(value);if(!Number.isSafeInteger(n)||n<0)throw new Error(`${label} must be nonnegative integer milliseconds`);return n;}
function type(value){if(!['task','project'].includes(value))throw new Error('Invalid node type');return value;}
function nextPosition(owner,parentId){return db.prepare("SELECT COALESCE(MAX(position),0)+1 n FROM tasks WHERE user_id=? AND parent_id IS ? AND status<>'cancelled'").get(owner,parentId).n;}
function subtree(owner,id){return db.prepare(`WITH RECURSIVE branch(id) AS (SELECT id FROM tasks WHERE user_id=? AND id=? UNION SELECT t.id FROM tasks t JOIN branch b ON t.parent_id=b.id WHERE t.user_id=?) SELECT t.* FROM tasks t JOIN branch b ON t.id=b.id`).all(owner,id,owner);}
function assertPaused(owner,ids){
    if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='work_intervals'").get())return;
    const stmt=db.prepare('SELECT 1 FROM work_intervals WHERE user_id=? AND task_id=? AND ended_at IS NULL');
    if(ids.some(id=>stmt.get(owner,id)))throw new Error('Pause or Stop Work before changing active task structure or completion.');
}
function validateParent(owner,id,parentId){
    if(parentId==null||parentId==='')return null;
    const pid=String(parentId),parent=requireNode(owner,pid);let cursor=parent;const seen=new Set([String(id)]);
    while(cursor){if(seen.has(cursor.id))throw new Error('Cannot create a project hierarchy cycle');seen.add(cursor.id);cursor=cursor.parent_id?requireNode(owner,cursor.parent_id):null;}
    if(parent.status==='cancelled')throw new Error('Restore a deleted parent before adding children.');
    return pid;
}
function snapshot(rows){return rows.map(row=>({...Object.fromEntries(['id','parent_id','project_id','position','status','node_type','independently_actionable','completed'].map(key=>[key,row[key]]))}));}
function markDerived(owner,id){if(id)db.prepare('UPDATE tasks SET estimated_from_children=1 WHERE user_id=? AND id=?').run(owner,id);}
function promote(owner,id){
    if(!id)return;
    const row=requireNode(owner,id);
    if(row.node_type==='task'){
        assertPaused(owner,[id]);
        db.prepare("UPDATE tasks SET node_type='project',independently_actionable=0,own_elapsed_ms=elapsed_ms,updated_at=? WHERE user_id=? AND id=?").run(Date.now(),owner,id);
    } else if(!row.estimated_from_children && !db.prepare('SELECT 1 FROM tasks WHERE user_id=? AND parent_id=? LIMIT 1').get(owner,id)) {
        // An old empty container can carry acknowledged history. Preserve it on
        // first decomposition instead of replacing it with the new child's zero.
        db.prepare('UPDATE tasks SET own_elapsed_ms=elapsed_ms WHERE user_id=? AND id=?').run(owner,id);
    }
    markDerived(owner,id);
}
function ensureSession(id,owner){
    const sid=String(id||`planner:${owner}`);
    if(db.prepare('SELECT 1 FROM users WHERE id=? AND id<>?').get(sid,owner)||db.prepare('SELECT 1 FROM tasks WHERE session_id=? AND (user_id IS NULL OR user_id<>?) LIMIT 1').get(sid,owner))throw new Error('Session does not belong to this user');
    db.prepare("INSERT INTO sessions(id,updated_at,total_available_time_ms,end_constraint) VALUES(?,?,0,'') ON CONFLICT(id) DO UPDATE SET updated_at=excluded.updated_at").run(sid,Date.now());return sid;
}
function transaction(owner,operation){return db.transaction(()=>{ensureUser(owner);const result=operation();require('./plan-policy').validate(owner);integrity.reconcile(owner);require('./plan-policy').refreshBlocked(owner);return result;})();}
function create(owner,input={}){
    const id=String(input.id||'').trim(),name=String(input.name||'').trim();if(!id||!name)throw new Error('id and name are required');
    if(db.prepare('SELECT 1 FROM tasks WHERE id=?').get(id))throw new Error('Task node already exists');
    const parent=validateParent(owner,id,input.parentId??input.parent_id??null),nodeType=type(input.nodeType??input.node_type??'task');
    const estimated=ms(input.estimatedTimeMs??input.estimated_ms??0),sid=ensureSession(input.sessionId||input.session_id,owner),now=Date.now();
    promote(owner,parent);
    db.prepare(`INSERT INTO tasks(id,session_id,user_id,parent_id,project_id,node_type,independently_actionable,name,status,estimated_ms,elapsed_ms,position,created,last_changed,updated_at)
        VALUES(?,?,?,?,?,?,?,?, 'pending',?,0,?,?,NULL,?)`).run(id,sid,owner,parent,parent,nodeType,nodeType==='project'?0:(input.independentlyActionable===false||input.independently_actionable===0?0:1),name,estimated,Number(input.position)>0?Number(input.position):nextPosition(owner,parent),Number(input.created||now),now);
    return requireNode(owner,id);
}
function reparent(owner,id,parentId,position){
    const row=requireNode(owner,id),parent=validateParent(owner,id,parentId),undo=snapshot([row]);
    // Validate the entire move before touching the destination (including promotion).
    if(parent && requireNode(owner,parent).node_type==='task')throw new Error('Use Add subtask to decompose the destination task before moving work into it.');
    markDerived(owner,row.parent_id);promote(owner,parent);
    db.prepare('UPDATE tasks SET parent_id=?,project_id=?,position=?,updated_at=? WHERE id=? AND user_id=?').run(parent,parent,Number(position)>0?Number(position):nextPosition(owner,parent),Date.now(),id,owner);
    return {node:requireNode(owner,id),undo};
}
function remove(owner,id,mode){
    const row=requireNode(owner,id),rows=subtree(owner,id),undo=snapshot(rows),now=Date.now();assertPaused(owner,rows.map(n=>n.id));markDerived(owner,row.parent_id);
    if(row.node_type==='project'&&rows.length>1&&mode==='ungroup'){
        // Include completed history; hiding it during ungroup must not strand it.
        const children=db.prepare('SELECT * FROM tasks WHERE user_id=? AND parent_id=? ORDER BY position,created').all(owner,id);let position=row.position||1;
        for(const child of children)db.prepare('UPDATE tasks SET parent_id=?,project_id=?,position=?,updated_at=? WHERE id=? AND user_id=?').run(row.parent_id,row.parent_id,position++,now,child.id,owner);
        db.prepare("UPDATE tasks SET status='cancelled',updated_at=? WHERE id=? AND user_id=?").run(now,id,owner);
    }else for(const child of rows)db.prepare("UPDATE tasks SET status='cancelled',updated_at=? WHERE id=? AND user_id=?").run(now,child.id,owner);
    return {success:true,nodeId:id,undo};
}
function progress(owner,id){
    const leaves=subtree(owner,id).filter(row=>row.node_type==='task'&&row.status!=='cancelled');
    const remaining=leaves.filter(row=>!['completed','cancelled'].includes(row.status));
    return {totalTasks:leaves.length,completedTasks:leaves.filter(row=>row.status==='completed').length,
        remainingEstimateMs:remaining.some(row=>row.estimated_ms<=0)?null:remaining.reduce((sum,row)=>sum+Math.max(0,row.estimated_ms-row.elapsed_ms),0)};
}
function buildTree(rows){const byId=new Map(rows.map(row=>[row.id,{...row,children:[]}])),roots=[];for(const row of byId.values()){row.progress=progress(row.user_id,row.id);const parent=byId.get(row.parent_id);if(parent)parent.children.push(row);else roots.push(row);}return roots;}
module.exports={
    ensureUser,
    claimUnownedTasks(){throw new Error('Anonymous task attribution requires an approved migration');},
    attachTask(owner,id){requireNode(owner,id);return {changes:0};},
    prependOpenTasks(owner,ids){return transaction(String(owner),()=>{for(const id of new Set(ids||[]))requireNode(owner,id);return openTasks.all(owner).length;});},
    getOpenTasks(owner){ensureUser(owner);return openTasks.all(String(owner));},
    importOpenTasksIntoSession(owner,sid){if(!String(sid||'').trim())throw new Error('session id is required');if(db.prepare('SELECT 1 FROM tasks WHERE session_id=? AND (user_id IS NULL OR user_id<>?) LIMIT 1').get(String(sid),String(owner)))throw new Error('Session does not belong to this user');return this.getOpenTasks(owner);},
    getRootNodes(owner){ensureUser(owner);return db.prepare("SELECT * FROM tasks WHERE user_id=? AND parent_id IS NULL AND status<>'cancelled' AND (node_type='project' OR status<>'completed') ORDER BY position,created").all(String(owner));},
    getChildren(owner,id){requireNode(owner,id);return childRows.all(String(owner),String(id));},
    getNode(owner,id){return requireNode(owner,id);},
    getProgress(owner,id){requireNode(owner,id);return progress(String(owner),String(id));},
    getTree(owner){ensureUser(owner);return buildTree(allNodes.all(String(owner)));},
    createNode(owner,input){const uid=String(owner),id=transaction(uid,()=>create(uid,input).id);return requireNode(uid,id);},
    updateNode(owner,id,input={}){const uid=String(owner);transaction(uid,()=>{
        const row=requireNode(uid,id),nodeType=type(input.nodeType??input.node_type??row.node_type),name=String(input.name??row.name).trim();if(!name)throw new Error('Name is required');
        const estimate=ms(input.estimatedTimeMs??input.estimated_ms??row.estimated_ms);
        if(input.parentId!==undefined||input.parent_id!==undefined)reparent(uid,id,input.parentId??input.parent_id,input.position);
        if(nodeType==='task'&&row.node_type==='project')throw new Error('A container cannot be converted back into a leaf by an edit.');
        if(nodeType==='project'&&row.node_type==='task'){
            assertPaused(uid,[id]);db.prepare('UPDATE tasks SET own_elapsed_ms=elapsed_ms WHERE user_id=? AND id=?').run(uid,id);
        }
        db.prepare('UPDATE tasks SET node_type=?,independently_actionable=?,name=?,estimated_ms=?,position=?,updated_at=? WHERE user_id=? AND id=?').run(nodeType,nodeType==='project'?0:(input.independentlyActionable??input.independently_actionable??row.independently_actionable)?1:0,name,estimate,Number(input.position??row.position),Date.now(),uid,id);
        if(input.status!==undefined){
            if(!['pending','completed'].includes(input.status))throw new Error('Editor completion status must be pending or completed');
            if(row.status==='cancelled')throw new Error('Restore a deleted task before changing its completion.');
            assertPaused(uid,[id]);
            if(input.status==='completed'&&subtree(uid,id).some(child=>child.id!==id&&['pending','active','blocked'].includes(child.status)))throw new Error('Complete open children before completing their parent.');
            db.prepare('UPDATE tasks SET status=?,completed=?,last_changed=NULL,updated_at=? WHERE user_id=? AND id=?').run(input.status,input.status==='completed'?(row.completed||Date.now()):null,Date.now(),uid,id);
        }
    });return requireNode(uid,id);},
    reparentNode(owner,id,parentId,position){return transaction(String(owner),()=>reparent(String(owner),String(id),parentId,position));},
    deleteNode(owner,id,mode='subtree'){return transaction(String(owner),()=>remove(String(owner),String(id),mode));},
    restoreSnapshot(owner,rows){const uid=String(owner);return transaction(uid,()=>{
        if(!Array.isArray(rows))throw new Error('A snapshot array is required');
        for(const row of rows){const current=requireNode(uid,row.id);if(row.node_type&&row.node_type!==current.node_type)throw new Error('Node decomposition changed since this undo. Refresh before editing.');assertPaused(uid,[row.id]);if(row.parent_id!=null)requireNode(uid,row.parent_id);}
        for(const row of rows)db.prepare('UPDATE tasks SET parent_id=?,project_id=?,position=?,status=?,completed=?,node_type=?,independently_actionable=?,updated_at=? WHERE user_id=? AND id=?').run(row.parent_id??null,row.parent_id??null,Number(row.position||0),row.status||'pending',row.completed??null,type(row.node_type||'task'),row.independently_actionable===0?0:1,Date.now(),uid,row.id);
        for(const row of rows){validateParent(uid,row.id,row.parent_id);if(row.parent_id!=null&&requireNode(uid,row.parent_id).node_type!=='project')throw new Error('Parent node must be a project');}
        return true;
    });},
    undo(owner,rows,deleteIds=[]){return transaction(String(owner),()=>{this.restoreSnapshot(owner,rows);for(const id of deleteIds)remove(String(owner),id,'subtree');return true;});},
    cancelNode(owner,id){return this.deleteNode(owner,id,'subtree');},
    batch(owner,input={}){const uid=String(owner);return transaction(uid,()=>{
        if(input.action==='insert'){
            const parent=requireNode(uid,input.parentId),children=childRows.all(uid,parent.id),index=Number(input.index);
            if(!Number.isInteger(index)||index<0||index>children.length)throw new Error('Invalid insertion position');
            for(let i=0;i<children.length;i++)db.prepare('UPDATE tasks SET position=? WHERE id=? AND user_id=?').run(i+(i>=index?2:1),children[i].id,uid);
            const row=create(uid,{...input.node,parentId:parent.id,position:index+1});return {node:row};
        }
        const ids=input.ids;if(!Array.isArray(ids)||!ids.length||new Set(ids).size!==ids.length)throw new Error('Unique node ids are required');
        ids.forEach(id=>requireNode(uid,id));
        if(ids.some(id=>subtree(uid,id).some(row=>row.id!==id&&ids.includes(row.id))))throw new Error('Select a subtree once, without its descendants.');
        if(input.action==='move'){
            const snapshot=[];for(const id of ids){const result=reparent(uid,id,input.parentId??null);snapshot.push(...result.undo);}return {undo:snapshot};
        }
        if(input.action==='group'){
            if(ids.length<2)throw new Error('Select at least two nodes');
            const parent=validateParent(uid,input.group?.id,input.parentId??null);
            if(ids.some(id=>requireNode(uid,id).parent_id!==parent))throw new Error('Group nodes must be siblings');
            const group=create(uid,{...input.group,nodeType:'project',parentId:parent}),undo=[];
            for(const id of ids)undo.push(...reparent(uid,id,group.id).undo);return {node:group,undo,deleteIds:[group.id]};
        }
        if(input.action==='order'){
            const parent=input.parentId??null;const children=childRows.all(uid,parent);
            if(children.length!==ids.length||children.some(row=>!ids.includes(row.id)))throw new Error('Sibling order changed. Refresh before sorting.');
            ids.forEach((id,index)=>db.prepare('UPDATE tasks SET position=?,updated_at=? WHERE id=? AND user_id=?').run(index+1,Date.now(),id,uid));return {success:true};
        }
        throw new Error('Unknown batch action');
    });}
};
