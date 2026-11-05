'use strict';
const domain=require('../frontend/plan-domain');
const db=require('./database').connection;
function data(owner) {
    const exists=db.prepare("SELECT 1 FROM sqlite_master WHERE name='plan_details'").get();
    const nodes=exists?db.prepare(`SELECT t.*,d.archived,d.earliest_start_at,d.scheduled_start_at FROM tasks t LEFT JOIN plan_details d ON d.task_id=t.id WHERE t.user_id=?`).all(owner):db.prepare('SELECT * FROM tasks WHERE user_id=?').all(owner);
    const dependencies=exists?db.prepare('SELECT * FROM plan_dependencies WHERE user_id=?').all(owner):[];
    return {nodes,dependencies};
}
function validate(owner) { const {nodes,dependencies}=data(owner);return domain.graph(nodes,dependencies); }
function assertStart(owner,id,now=Date.now()) {
    const g=validate(owner),reasons=g.blocked(id),node=g.byId.get(id);
    if(reasons.length)throw new Error('Task is blocked: '+reasons.join(', '));
    if([node,...g.ancestors(id)].some(n=>(n.earliest_start_at||0)>now||(n.scheduled_start_at||0)>now))throw new Error('Task cannot start before its earliest or scheduled start');
}
function refreshBlocked(owner){
    const g=validate(owner);
    for(const n of g.byId.values())if(n.status==='blocked'&&g.gates.get(n.id).size>0&&!g.blocked(n.id).length)db.prepare("UPDATE tasks SET status='pending',blocked_by_task_id=NULL,updated_at=? WHERE user_id=? AND id=?").run(Date.now(),owner,n.id);
}
module.exports={data,validate,assertStart,refreshBlocked};
