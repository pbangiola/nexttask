'use strict';
// Local-only adapter for the shared workflow. No HTTP calls or account attribution.
window.createGuestGraph = () => {
    const key = 'nexttaskGuestGraph_v1';
    const empty = () => ({ nodes: {}, sessions: {}, intervals: {}, activeId: null, runs: {} });
    let data;
    try { data = JSON.parse(localStorage.getItem(key) || 'null'); } catch (_) {}
    data = data?.nodes && data.sessions && data.intervals && data.runs ? data : empty();
    let chain = Promise.resolve(), failure = null, invalid = false, pending = 0;
    window.activeWorkSessionId = data.activeId;
    function assertGuest() { if (invalid || window.taskSorterMode !== 'guest') throw new Error('Guest experience changed. Reload.'); }
    function persist() { assertGuest(); localStorage.setItem(key, JSON.stringify(data)); }
    function endSession(row, at) {
        if (row.status !== 'open') return;
        row.status = 'ended'; row.ended_at = at; row.updated_at = Date.now();
        for (const interval of Object.values(data.intervals)) if (interval.work_session_id === row.id && interval.ended_at == null) stop(interval, at);
        if (data.activeId === row.id) { data.activeId = null; window.activeWorkSessionId = null; }
    }
    function stop(row, at) {
        if (row.ended_at != null) return;
        row.ended_at = Math.max(row.started_at, at); row.duration_ms = row.ended_at - row.started_at;
        delete data.runs[row.task_id];
    }
    function actionable(row) { return row && row.node_type === 'task' && row.independently_actionable === 1 && ['pending','active'].includes(row.status); }
    async function request(path, method = 'GET', body = {}) {
        assertGuest();
        const previous = JSON.stringify(data);
        try {
            let result;
            const parts = path.split('?')[0].split('/').filter(Boolean).map(decodeURIComponent);
            if (parts[0] === 'session' && parts[2] === 'tasks') {
                if (method === 'PUT') {
                    for (const task of body.tasks) {
                        const old = data.nodes[task.id];
                        if (old && ['completed','cancelled'].includes(old.status)) continue;
                        data.nodes[task.id] = { ...old, id: task.id, user_id:'guest_local',session_id:'guest_local',parent_id:old?.parent_id || null,node_type:'task',
                            independently_actionable:old?.independently_actionable ?? (task.independentlyActionable === false ? 0 : 1),
                            name:old?.name || task.name,status:task.status,estimated_ms:old?.estimated_ms > 0 ? old.estimated_ms : task.estimatedTimeMs,
                            elapsed_ms:task.actualTimeMs,position:old?.position ?? task.position,created:task.created,started:task.started,
                            completed:task.completedTime,last_changed:task.lastChanged,blocked_by_task_id:task.blockedByTaskId };
                    }
                }
                result = { tasks:Object.values(data.nodes),success:true };
            } else if (parts[0] === 'users' && parts[2] === 'nodes' && method === 'GET') result = { nodes:Object.values(data.nodes).map(row => ({...row,children:[]})) };
            else if (path === '/work-sessions/open') result = { workSession:Object.values(data.sessions).filter(s=>s.status==='open').sort((a,b)=>b.updated_at-a.updated_at)[0] || null };
            else if (path === '/work-sessions/prepare') {
                let row = data.sessions[body.id];
                if (!row) {
                    if (!body.taskIds?.length || body.taskIds.some(id=>!actionable(data.nodes[id]))) throw new Error('Guest queue needs eligible saved tasks.');
                    row = data.sessions[body.id] = { id:body.id,status:'open',started_at:body.startedAt,available_ms:body.availableMs || 0,hard_stop_at:body.hardStopAt,end_constraint:body.endConstraint || '',updated_at:Date.now(),items:[...body.taskIds] };
                    if (body.replaceSessionId && data.sessions[body.replaceSessionId]) endSession(data.sessions[body.replaceSessionId],body.replacedAt);
                }
                data.activeId = row.status === 'open' ? row.id : null;
                window.activeWorkSessionId = data.activeId; data.runs = {};
                result = {workSession:row,items:row.items.map(id=>data.nodes[id])};
            } else if (parts[0] === 'work-sessions') {
                const row = data.sessions[parts[1]];
                if (!row) throw new Error('Local session not found.');
                if (parts[2] === 'items' && method === 'PUT') {
                    if (row.status !== 'open' || body.taskIds.some(id=>!actionable(data.nodes[id]))) throw new Error('Guest task is not eligible.');
                    row.items = [...body.taskIds];
                }
                if (parts[2] === 'end') endSession(row, body.endedAt);
                result = parts[2] === 'open-intervals' ? { intervals:Object.values(data.intervals).filter(i=>i.work_session_id===row.id && i.ended_at==null) }
                    : {workSession:row,items:row.items.map((id,index)=>({...data.nodes[id],rank:index+1})),history:Object.values(data.intervals).filter(i=>i.work_session_id===row.id).map(i=>data.nodes[i.task_id])};
            } else if (path === '/work-intervals' && method === 'POST') {
                let row = data.intervals[body.id];
                if (!row) {
                    const session = data.sessions[body.workSessionId];
                    if (!actionable(data.nodes[body.taskId]) || session?.status !== 'open' || !session.items.includes(body.taskId)) throw new Error('Guest task is not eligible.');
                    row = data.intervals[body.id] = {id:body.id,task_id:body.taskId,work_session_id:body.workSessionId,started_at:body.startedAt,ended_at:null};
                }
                if (row.ended_at == null) data.runs[row.task_id]={id:row.id,startedAt:row.started_at};
                result = {interval:row};
            } else if (parts[0] === 'work-intervals' && parts[2] === 'stop') {
                const row=data.intervals[parts[1]]; if(!row)throw new Error('Local interval not found.'); stop(row,body.endedAt); result={interval:row};
            } else throw new Error('This view requires sign-in. Guest tasks remain local.');
            if (method !== 'GET') persist();
            return JSON.parse(JSON.stringify(result));
        } catch (error) { data=JSON.parse(previous); window.activeWorkSessionId=data.activeId; throw error; }
    }
    function commit(label,steps,ack) {
        pending++;
        const execute=async()=>{const results=[];for(const step of steps)results.push(await request(step.path,step.method,step.body));ack?.(results);failure=null;return results;};
        const result=chain.then(execute).then(result=>{pending--;window.dispatchEvent(new CustomEvent('durability-status',{detail:{message:pending?'Saving locally…':'Saved locally',failed:false}}));return result;},error=>{pending--;failure=error;window.dispatchEvent(new CustomEvent('durability-status',{detail:{message:'Local save failed. Free browser storage and reload.',failed:true}}));throw error;});
        chain=result.catch(()=>{});
        result.catch(()=>{});return result;
    }
    return { request,commit,flush:()=>failure?Promise.reject(failure):chain,retry:()=>failure?Promise.reject(failure):chain,failed:()=>!!failure,pending:()=>pending>0,
        reserve(taskId,startedAt){data.runs[taskId] ||= {id:createId('interval'),startedAt};persist();return data.runs[taskId];},
        run:id=>data.runs[id],runs:()=>Object.entries(data.runs),adopt(id,intervals){data.activeId=id;window.activeWorkSessionId=id;data.runs=Object.fromEntries(intervals.map(i=>[i.task_id,{id:i.id,startedAt:i.started_at}]));persist();},
        async validateRecovery(){if(data.activeId && data.sessions[data.activeId]?.status!=='open'){data.activeId=null;data.runs={};window.activeWorkSessionId=null;persist();return true;}},
        canReturnToSavedWork:()=>false,invalidate(){invalid=true;},
        openIntervals:id=>request(`/work-sessions/${encodeURIComponent(id)}/open-intervals`).then(r=>r.intervals)
    };
};
