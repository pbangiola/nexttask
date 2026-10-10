'use strict';

// Durable-domain helpers for the task-graph architecture.  The existing UI can
// migrate onto these APIs incrementally without changing task identity.
window.TaskGraph = (() => {
    const uuid = prefix => `${prefix}_${globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2)}`;

    async function jsonFetch(path, options={}) {
        const response=await fetch(`${API_BASE_URL}${path}`,options);
        if(!response.ok){let detail='';try{detail=(await response.json()).error||'';}catch{}throw new Error(detail||`Request failed (${response.status})`);}
        return response.json();
    }
    function actionableLeaves(nodes){
        const flat=[];
        const walk=node=>{
            const children=Array.isArray(node.children)?node.children:[];
            const open=!['completed','cancelled'].includes(node.status);
            if(!open)return;
            if(node.node_type!=='project' && node.independently_actionable!==0) flat.push(node);
            children.forEach(walk);
        };
        (nodes||[]).forEach(walk);
        return flat;
    }
    async function createWorkSession({availableMs=0,hardStopAt=null,endConstraint='',taskIds=[]}={}){
        const id=uuid('work');
        const {workSession}=await jsonFetch('/api/work-sessions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,availableMs,hardStopAt,endConstraint})});
        if(taskIds.length) await setQueue(id,taskIds);
        return workSession;
    }
    async function actionableTasks(){return (await jsonFetch('/api/tasks/actionable')).tasks;}
    async function openWorkSession(){return (await jsonFetch('/api/work-sessions/open')).workSession;}
    async function getWorkSession(id){return jsonFetch(`/api/work-sessions/${encodeURIComponent(id)}`);}
    async function openIntervals(id){return (await jsonFetch(`/api/work-sessions/${encodeURIComponent(id)}/open-intervals`)).intervals;}
    async function setQueue(id,taskIds){return (await jsonFetch(`/api/work-sessions/${encodeURIComponent(id)}/items`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({taskIds})})).items;}
    async function endWorkSession(id){return (await jsonFetch(`/api/work-sessions/${encodeURIComponent(id)}/end`,{method:'POST'})).workSession;}
    async function startWork(taskId,workSessionId=null){
        const id=uuid('interval');
        return (await jsonFetch('/api/work-intervals',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,taskId,workSessionId,startedAt:Date.now()})})).interval;
    }
    async function stopWork(intervalId,endedAt=Date.now()){
        return (await jsonFetch(`/api/work-intervals/${encodeURIComponent(intervalId)}/stop`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({endedAt})})).interval;
    }
    async function intervals(taskId){return (await jsonFetch(`/api/tasks/${encodeURIComponent(taskId)}/work-intervals`)).intervals;}

    return {actionableLeaves,actionableTasks,createWorkSession,openWorkSession,getWorkSession,openIntervals,setQueue,endWorkSession,startWork,stopWork,intervals};
})();
