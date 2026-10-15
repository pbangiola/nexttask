'use strict';
// Pure projections of the existing canonical ancestry + Work queue. No store.
(() => {
    const unfinished=task=>!task.isSortingOverhead&&!task.completed&&!['completed','cancelled'].includes(task.status);
    const queued=task=>unfinished(task)&&['pending','active'].includes(task.status)&&(task.nodeType||'task')==='task'&&task.independentlyActionable!==false;
    function snoozed(tasks,parentId) {
        const member=tasks.find(task=>(task.projectAncestorIds||[]).includes(parentId));
        if(!member)return null;
        const depth=member.projectAncestorIds.indexOf(parentId),prefix=member.projectAncestorIds.slice(0,depth);
        const inScope=task=>!task.isSortingOverhead&&prefix.every((id,index)=>task.projectAncestorIds?.[index]===id);
        const blocks=[],byId=new Map();
        for(const task of tasks.filter(inScope)){
            const key=task.projectAncestorIds?.[depth]||task.id;
            if(!byId.has(key)){const block={id:key,tasks:[]};byId.set(key,block);blocks.push(block);}
            byId.get(key).tasks.push(task);
        }
        const index=blocks.findIndex(block=>block.id===parentId);
        if(index<0||!blocks[index].tasks.some(queued))return null;
        const next=blocks.findIndex((block,i)=>i>index&&block.tasks.some(queued));
        if(next<0)return null;
        const [block]=blocks.splice(index,1);blocks.splice(next,0,block);
        const reordered=blocks.flatMap(item=>item.tasks);let cursor=0;
        return tasks.map(task=>inScope(task)?reordered[cursor++]:task);
    }
    function parents(tasks) {
        const found=new Map();
        for(const task of tasks.filter(unfinished))for(const [index,id] of (task.projectAncestorIds||[]).entries()){
            if(!found.has(id))found.set(id,{id,name:task.projectAncestorNames?.[index]||task.projectPath?.split(' › ')[index]||id});
        }
        return [...found.values()].map(parent=>({...parent,canSnooze:snoozed(tasks,parent.id)!==null}));
    }
    const api={snoozed,parents};
    if(typeof window!=='undefined')window.ProjectQueue=api;
    if(typeof module!=='undefined')module.exports=api;
})();
