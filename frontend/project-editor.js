'use strict';

window.ProjectEditor = (() => {
    const UNDO_KEY = `nextTaskProjectEditorUndo_${userId}`;
    const esc = value => String(value ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\"/g,'&quot;').replace(/'/g,'&#039;');
    const makeId = prefix => `${prefix}_${globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2,11)}`;
    const history=[];
    let currentId=null;
    let returnToOrigin=()=>window.ProjectPlanner.showProjects();
    let navigation=0;

    async function api(path,options={}){const r=await fetch(`${API_BASE_URL}/api/users/${encodeURIComponent(userId)}${path}`,{...options,headers:{'Content-Type':'application/json',...(options.headers||{})}});let body=null;try{body=await r.json();}catch(_){}if(!r.ok)throw new Error(body?.error||`Project request failed (${r.status})`);return body;}
    async function getNode(id){return api(`/nodes/${encodeURIComponent(id)}`);}
    async function roots(){return (await api('/nodes')).nodes||[];}
    async function tree(){return (await api('/nodes?tree=1')).nodes||[];}
    async function createNode(input){return (await api('/nodes',{method:'POST',body:JSON.stringify({id:input.id||makeId(input.nodeType==='project'?'project':'task'),...input})})).node;}
    async function updateNode(id,input){return (await api(`/nodes/${encodeURIComponent(id)}`,{method:'PUT',body:JSON.stringify(input)})).node;}
    async function reparent(id,parentId,position){return api(`/nodes/${encodeURIComponent(id)}/parent`,{method:'PUT',body:JSON.stringify({parentId,position})});}
    async function removeNode(id,mode='subtree'){return api(`/nodes/${encodeURIComponent(id)}?mode=${encodeURIComponent(mode)}`,{method:'DELETE'});}
    async function restore(snapshot,deleteIds=[]){return api('/nodes/undo',{method:'POST',body:JSON.stringify({snapshot,deleteIds})});}
    async function batch(input){return api('/nodes/batch',{method:'POST',body:JSON.stringify(input)});}

    function shell(){hideStaticScreens();hide(el('stopWorkingBtn'));hide(el('startOverBtn'));hide(el('taskCompare'));return clearDynamic();}
    function minutes(ms){return Number(ms||0)/60000;}
    function setUndo(entry){localStorage.setItem(UNDO_KEY,JSON.stringify(entry));}
    function getUndo(){try{return JSON.parse(localStorage.getItem(UNDO_KEY)||'null');}catch(_){return null;}}
    function clearUndo(){localStorage.removeItem(UNDO_KEY);}
    function flattenProjects(nodes,out=[]){for(const n of nodes||[]){if(n.node_type==='project'&&n.status!=='cancelled')out.push(n);flattenProjects(n.children||[],out);}return out;}

    function updateTopBackVisibility(){
        const topBack=el('projectEditorBackTop');
        if(!topBack)return;
        topBack.classList.add('hidden');
        const pageIsLong=document.documentElement.scrollHeight>window.innerHeight;
        topBack.classList.toggle('hidden',!pageIsLong);
    }

    async function backFromProjectEditor(){
        if(history.length)return open(history.pop(),{push:false});
        currentId=null;
        return returnToOrigin();
    }

    window.addEventListener('resize',()=>requestAnimationFrame(updateTopBackVisibility));

    async function undoLast(){const entry=getUndo();if(!entry)return;try{if(entry.snapshot?.length)await restore(entry.snapshot,entry.deleteIds||[]);clearUndo();await open(entry.returnId||currentId,{push:false});}catch(error){alert(`Undo failed: ${error.message}`);}}

    function returnToParent(parent) { return parent.id ? open(parent.id,{push:false}) : returnToOrigin(); }

    async function open(projectId,options={}){
        const request=++navigation;
        try{
            if(!projectId)return;
            if(options.origin){history.length=0;currentId=null;returnToOrigin=options.origin;}
            if(options.push!==false&&currentId&&currentId!==projectId)history.push(currentId);
            currentId=projectId;
            const {node,children,progress}=await getNode(projectId);
            if(request!==navigation)return;
            if(node.node_type!=='project')throw new Error('Only projects can be opened in the project editor.');
            const tasks=children.filter(c=>c.node_type!=='project');
            const projects=children.filter(c=>c.node_type==='project');
            const c=shell();
            c.innerHTML=`<h2>${esc(node.name)}</h2><p>${minutes(node.estimated_ms)} min planned estimate${node.estimated_from_children ? " (calculated from non-deleted children; completed estimates retained)" : ""}</p><span>Progress: ${progress.completedTasks}/${progress.totalTasks} tasks completed; remaining estimate ${progress.remainingEstimateMs==null?'Unestimated':Number(progress.remainingEstimateMs)/60000+' min'}.</span><button id="projectEditorMetadata">Edit Project Details</button>
                <button id="projectEditorBackTop" class="projectEditorBack hidden">Back</button>
                <h3 id="projectEditorTasksHeading">Tasks</h3><div id="projectEditorTasks"></div>
                <h3>Projects</h3><div id="projectEditorProjects"></div>
                <div class="planner-choice-grid"><button id="projectEditorSortLevel">Sort This Level</button><button id="projectEditorGroup">Group Selected</button><button id="projectEditorMoveSelected">Move Selected</button><button id="projectEditorAddTask">Add Task</button><button id="projectEditorAddProject">Add Subproject</button></div>
                ${getUndo()?'<button id="projectEditorUndo">Undo Last Change</button>':''}
                <button class="projectEditorBack">Back</button>`;
            renderRows(el('projectEditorTasks'),tasks,node,false);
            renderRows(el('projectEditorProjects'),projects,node,true);
            if(!tasks.length)el('projectEditorTasks').innerHTML='<p>No loose tasks at this level.</p>';
            if(!projects.length)el('projectEditorProjects').innerHTML='<p>No subprojects at this level.</p>';
            el('projectEditorSortLevel').disabled=children.length<2;el('projectEditorSortLevel').onclick=()=>sortCurrentLevel(node,children);el('projectEditorGroup').onclick=()=>showGroup(node);
            el('projectEditorMoveSelected').onclick=()=>showMoveSelected(node);
            el('projectEditorMetadata').onclick=()=>showEdit(node,node,true);
            el('projectEditorAddTask').onclick=()=>showAddTask(node);
            el('projectEditorAddProject').onclick=()=>showAddProject(node);
            if(el('projectEditorUndo'))el('projectEditorUndo').onclick=undoLast;
            document.querySelectorAll('.projectEditorBack').forEach(button=>button.onclick=backFromProjectEditor);
            requestAnimationFrame(updateTopBackVisibility);
        }catch(error){if(request!==navigation)return;console.error(error);const c=shell();c.innerHTML=`<h2>Project Editor</h2><p>${esc(error.message||'Could not open project.')}</p><button id="projectEditorErrorBack">Back</button>`;el('projectEditorErrorBack').onclick=backFromProjectEditor;}
    }

    async function sortCurrentLevel(parent,children){const ordered=[...(children||[])].sort((a,b)=>(Number(a.position||0)-Number(b.position||0))||(Number(a.created||0)-Number(b.created||0)));if(ordered.length<2)return;try{shell();show(el('taskCompare'));const runId=++sortRunId,sorted=await interactiveMergeSort(ordered,runId);hide(el('taskCompare'));if(runId!==sortRunId)return;await batch({action:'order',parentId:parent.id,ids:sorted.map(row=>row.id)});returnToParent(parent);}catch(error){hide(el('taskCompare'));alert(error.message);}}

    function renderRows(container,items,parent,isProject){
        items.forEach(item=>{const row=document.createElement('div');row.className=isProject?'planner-project-row':'planner-order-row';row.dataset.nodeId=item.id;row.innerHTML=`<label class="planner-check"><input class="projectEditorSelect" type="checkbox" value="${esc(item.id)}"><span></span></label>`;const span=row.querySelector('span');
            if(isProject){const link=document.createElement('button');link.className='planner-project-link';link.textContent=item.name;link.onclick=()=>open(item.id);span.appendChild(link);span.append(` — ${minutes(item.estimated_ms)} min`);}else span.textContent=`${item.name} — ${minutes(item.estimated_ms)} min`;
            span.append(` [${item.status}]`);
            const completion=document.createElement('button');completion.textContent=item.status==='completed'?'Reopen':'Complete';completion.onclick=async()=>{completion.disabled=true;try{await updateNode(item.id,{status:item.status==='completed'?'pending':'completed'});await returnToParent(parent);}catch(error){alert(error.message);completion.disabled=false;}};
            const move=document.createElement('button');move.textContent='Move';move.onclick=()=>showMove(item,parent);
            const del=document.createElement('button');del.textContent='Delete';del.onclick=()=>showDelete(item,parent);
            const edit=document.createElement('button');edit.textContent='Edit';edit.onclick=()=>showEdit(item,parent,isProject);
            row.append(edit,move,del,completion);
            if(isProject){const ungroup=document.createElement('button');ungroup.textContent='Ungroup';ungroup.onclick=()=>ungroupProject(item,parent);row.appendChild(ungroup);}
            container.appendChild(row);});
    }
    async function showEdit(item,parent,isProject=false){
        const request=++navigation;
        try{
            const {node,children}=await getNode(item.id);
            if(request!==navigation)return;
            const derived=isProject&&Boolean(node.estimated_from_children||children.length);
            const c=shell();
            c.innerHTML=`<h2>Edit ${isProject?'Project':'Task'}</h2><label>Name<input id="projectEditorEditName"></label>
                <label>${derived?'Calculated planned estimate':'Estimated minutes'}<input id="projectEditorEditMinutes" type="number" min="0" step="any" ${derived?'disabled':''}></label>
                <button id="projectEditorAddSubtask">Add subtask</button><p>Adding children uses this same node as a container. Child estimates replace its estimate; recorded actual time is retained.</p><button id="projectEditorEditSave">Save</button><button id="projectEditorEditCancel">Cancel</button>`;
            el('projectEditorAddSubtask').onclick=()=>showAddTask(node);
            el('projectEditorEditName').value=node.name;
            el('projectEditorEditMinutes').value=Number(node.estimated_ms||0)/60000;
            el('projectEditorEditSave').onclick=async()=>{
                const name=el('projectEditorEditName').value.trim(),mins=Number(el('projectEditorEditMinutes').value);
                if(!name||!Number.isFinite(mins)||mins<0)return alert('Enter a name and valid estimate.');
                const save=el('projectEditorEditSave');save.disabled=true;
                el('projectEditorEditCancel').disabled=true;el('projectEditorAddSubtask').disabled=true;
                try{
                    await updateNode(node.id,{name,...(derived?{}:{estimatedTimeMs:Math.round(mins*60000)})});
                    await returnToParent(parent);
                }catch(error){alert(error.message);save.disabled=false;el('projectEditorEditCancel').disabled=false;el('projectEditorAddSubtask').disabled=false;}
            };
            el('projectEditorEditCancel').onclick=()=>returnToParent(parent);
        }catch(error){alert(error.message);}
    }

    function selectedIds(){return Array.from(document.querySelectorAll('.projectEditorSelect:checked')).map(i=>i.value);}

    async function showMove(item,parent){try{const projects=flattenProjects(await tree()).filter(p=>p.id!==item.id);const c=shell();c.innerHTML=`<h2>Move ${esc(item.name)}</h2><p>Choose a destination.</p><div id="moveDestinations" class="planner-list"></div><button id="moveBack">Back</button>`;const list=el('moveDestinations');const add=(label,id)=>{const b=document.createElement('button');b.textContent=label;b.onclick=async()=>{try{const result=await reparent(item.id,id);setUndo({snapshot:result.undo,returnId:parent.id});returnToParent(parent);}catch(e){alert(e.message);}};list.appendChild(b);};add('Uncategorized Backlog',null);projects.forEach(p=>add(p.name,p.id));el('moveBack').onclick=()=>returnToParent(parent);}catch(error){alert(error.message);}}

    async function showMoveSelected(parent){const ids=selectedIds();if(!ids.length)return alert('Select at least one task or project.');try{const [{children},allProjects]=await Promise.all([getNode(parent.id),tree()]),order=new Map([...(children||[])].sort((a,b)=>Number(a.position||0)-Number(b.position||0)).map((n,i)=>[n.id,i])),orderedIds=[...ids].sort((a,b)=>(order.get(a)??999999)-(order.get(b)??999999)),projects=flattenProjects(allProjects),c=shell();c.innerHTML=`<h2>Move Selected</h2><div id="moveSelectedDestinations" class="planner-list"></div><button id="moveSelectedBack">Back</button>`;const list=el('moveSelectedDestinations'),add=(label,id)=>{const b=document.createElement('button');b.textContent=label;b.onclick=async()=>{try{const result=await batch({action:'move',ids:orderedIds,parentId:id});setUndo({snapshot:result.undo,returnId:parent.id});returnToParent(parent);}catch(e){alert(e.message);}};list.appendChild(b);};add('Uncategorized Backlog',null);projects.filter(p=>!ids.includes(p.id)).forEach(p=>add(p.name,p.id));el('moveSelectedBack').onclick=()=>returnToParent(parent);}catch(error){alert(error.message);}}

    function showGroup(parent){const ids=selectedIds();if(ids.length<2)return alert('Select at least two items to group.');const c=shell();c.innerHTML=`<h2>Group Selected</h2><label>New subproject name<input id="groupName"></label><button id="groupSave">Create Group</button><button id="groupBack">Back</button>`;el('groupSave').onclick=async()=>{const name=el('groupName').value.trim();if(!name)return alert('Give the group a name.');try{const result=await batch({action:'group',ids,parentId:parent.id,group:{id:makeId('project'),name,sessionId}});setUndo({snapshot:result.undo,deleteIds:result.deleteIds,returnId:parent.id});returnToParent(parent);}catch(error){alert(error.message);}};el('groupBack').onclick=()=>returnToParent(parent);}

    async function ungroupProject(item,parent){try{const result=await removeNode(item.id,'ungroup');setUndo({snapshot:result.undo,returnId:parent.id});returnToParent(parent);}catch(error){alert(error.message);}}

    async function showDelete(item,parent){const {children}=await getNode(item.id);if(item.node_type==='project'&&children.length){const c=shell();c.innerHTML=`<h2>Delete ${esc(item.name)}?</h2><p>This project contains ${children.length} direct item${children.length===1?'':'s'}.</p><div class="planner-choice-grid"><button id="deleteAll">Delete Project & Contents</button><button id="deleteUngroup">Keep Contents / Ungroup</button></div><button id="deleteBack">Back</button>`;el('deleteAll').onclick=()=>performDelete(item,parent,'subtree');el('deleteUngroup').onclick=()=>performDelete(item,parent,'ungroup');el('deleteBack').onclick=()=>returnToParent(parent);return;}if(confirm(`Delete “${item.name}”?`))performDelete(item,parent,'subtree');}
    async function performDelete(item,parent,mode){try{const result=await removeNode(item.id,mode);setUndo({snapshot:result.undo,returnId:parent.id});returnToParent(parent);}catch(error){alert(error.message);}}

    function showAddTask(parent){
        const c=shell();
        c.innerHTML=`<h2>Add Task to ${esc(parent.name)}</h2><label>Task name<input id="projectEditorTaskName"></label><label>Estimated time (optional shortcut)<input id="projectEditorTaskMinutes" type="number" min="1" placeholder="Minutes"></label><label><input id="projectEditorTaskDefer" type="checkbox">Add estimate later</label><button id="projectEditorTaskNext">Choose Position</button><button id="projectEditorTaskCancel">Back</button>`;
        el('projectEditorTaskNext').onclick=()=>{
            const parsed=parseTaskEntries(el('projectEditorTaskName').value);
            const mins=Number(el('projectEditorTaskMinutes').value);
            if(parsed.invalid.length||parsed.entries.length!==1)return alert('Enter one task.');
            if(el('projectEditorTaskMinutes').value&&(!Number.isFinite(mins)||mins<=0))return alert('Enter a positive estimate.');
            const draft={...parsed.entries[0]};
            if(mins>0)draft.estimatedTimeMs=Math.round(mins*60000);
            const insert=async()=>{
                try{const {children}=await getNode(parent.id);showTaskInsertion(parent,{name:draft.name,mins:draft.estimatedTimeMs/60000},children);}
                catch(error){alert(error.message);}
            };
            if(el('projectEditorTaskDefer').checked)insert();else collectMissingEstimates([draft],insert,()=>returnToParent(parent));
        };
        el('projectEditorTaskCancel').onclick=()=>returnToParent(parent);
    }

    function showTaskInsertion(parent,draft,children){
        const ordered=[...(children||[])].sort((a,b)=>(Number(a.position||0)-Number(b.position||0))||(Number(a.created||0)-Number(b.created||0)));
        const c=shell();
        c.innerHTML=`<h2>Where should this task go?</h2><p class="planner-moving">${esc(draft.name)} — ${draft.mins?draft.mins+' min':'Unestimated'}</p><div id="projectEditorInsertSlots" class="planner-list"></div><button id="projectEditorInsertBack">Back</button>`;
        const list=el('projectEditorInsertSlots');
        for(let i=0;i<=ordered.length;i++){
            const button=document.createElement('button');
            button.textContent=i===ordered.length?'Add at end':`Add before ${ordered[i].name}`;
            button.onclick=async()=>{
                el('projectEditorInsertSlots').querySelectorAll('button').forEach(item=>item.disabled=true);el('projectEditorInsertBack').disabled=true;
                try{
                    const result=await batch({action:'insert',parentId:parent.id,index:i,node:{id:makeId('task'),name:draft.name,nodeType:'task',estimatedTimeMs:Math.round(draft.mins*60000),sessionId}});
                    if(parent.node_type==='task')await open(parent.id);else await returnToParent(parent);
                    const offer=document.createElement('div');offer.id='projectEditorDecomposeOffer';
                    offer.textContent=`Break “${draft.name}” into smaller parts? `;
                    const decompose=document.createElement('button');decompose.textContent='Add subtask';decompose.onclick=()=>showAddTask(result.node);
                    const skip=document.createElement('button');skip.id='projectEditorDecomposeSkip';skip.textContent='Keep as one task';skip.onclick=()=>offer.remove();offer.append(decompose,skip);el('projectEditorTasks')?.before(offer);
                }catch(error){
                    alert(error.message);
                    el('projectEditorInsertSlots').querySelectorAll('button').forEach(item=>item.disabled=false);el('projectEditorInsertBack').disabled=false;
                }
            };
            list.appendChild(button);
        }
        el('projectEditorInsertBack').onclick=()=>showAddTask(parent);
    }

    function showAddProject(parent){const c=shell();c.innerHTML=`<h2>Add Subproject to ${esc(parent.name)}</h2><label>Project name<input id="projectEditorProjectName"></label><label>Estimated time (optional)<input id="projectEditorProjectMinutes" type="number" min="1" placeholder="Minutes"></label><button id="projectEditorProjectSave">Add Subproject</button><button id="projectEditorProjectCancel">Back</button>`;el('projectEditorProjectSave').onclick=async()=>{const name=el('projectEditorProjectName').value.trim(),mins=Number(el('projectEditorProjectMinutes').value);if(!name)return alert('Please enter a project name.');if(el('projectEditorProjectMinutes').value&&(!Number.isFinite(mins)||mins<1))return alert('Enter a positive estimate or leave it blank.');try{const child=await createNode({name,nodeType:'project',parentId:parent.id,estimatedTimeMs:Math.round((mins||0)*60000),independentlyActionable:false,sessionId});await open(child.id);}catch(error){alert(error.message);}};el('projectEditorProjectCancel').onclick=()=>returnToParent(parent);}



    async function editTask(id, options={}) { history.length=0;currentId=null;returnToOrigin=options.origin||returnToOrigin;const {node}=await getNode(id);if(node.node_type!=='task')throw new Error('A task is required.');return showEdit(node,{id:node.parent_id},false); }
    async function moveTask(id, options={}) { history.length=0;currentId=null;returnToOrigin=options.origin||returnToOrigin;const {node}=await getNode(id);return showMove(node,{id:node.parent_id}); }
    return {open,editTask,moveTask};
})();