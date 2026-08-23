'use strict';

window.ProjectEditor = (() => {
    const UNDO_KEY = 'nextTaskProjectEditorUndo';
    const esc = value => String(value ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\"/g,'&quot;').replace(/'/g,'&#039;');
    const makeId = prefix => `${prefix}_${globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2,11)}`;
    const history=[];
    let currentId=null;

    async function api(path,options={}){const r=await fetch(`${API_BASE_URL}/api/users/${encodeURIComponent(userId)}${path}`,{...options,headers:{'Content-Type':'application/json',...(options.headers||{})}});let body=null;try{body=await r.json();}catch(_){}if(!r.ok)throw new Error(body?.error||`Project request failed (${r.status})`);return body;}
    async function getNode(id){return api(`/nodes/${encodeURIComponent(id)}`);}
    async function roots(){return (await api('/nodes')).nodes||[];}
    async function tree(){return (await api('/nodes?tree=1')).nodes||[];}
    async function createNode(input){return (await api('/nodes',{method:'POST',body:JSON.stringify({id:input.id||makeId(input.nodeType==='project'?'project':'task'),...input})})).node;}
    async function updateNode(id,input){return (await api(`/nodes/${encodeURIComponent(id)}`,{method:'PUT',body:JSON.stringify(input)})).node;}
    async function reparent(id,parentId,position){return api(`/nodes/${encodeURIComponent(id)}/parent`,{method:'PUT',body:JSON.stringify({parentId,position})});}
    async function removeNode(id,mode='subtree'){return api(`/nodes/${encodeURIComponent(id)}?mode=${encodeURIComponent(mode)}`,{method:'DELETE'});}
    async function restore(snapshot){return api('/nodes/undo',{method:'POST',body:JSON.stringify({snapshot})});}

    function shell(){hideStaticScreens();hide(el('stopWorkingBtn'));hide(el('startOverBtn'));hide(el('taskCompare'));return clearDynamic();}
    function minutes(ms){return Math.round(Number(ms||0)/60000);}
    function setUndo(entry){localStorage.setItem(UNDO_KEY,JSON.stringify(entry));}
    function getUndo(){try{return JSON.parse(localStorage.getItem(UNDO_KEY)||'null');}catch(_){return null;}}
    function clearUndo(){localStorage.removeItem(UNDO_KEY);}
    function flattenProjects(nodes,out=[]){for(const n of nodes||[]){if(n.node_type==='project'&&!['completed','cancelled'].includes(n.status))out.push(n);flattenProjects(n.children||[],out);}return out;}

    function positionProjectEditorNavigation(){
        const topControls=el('projectEditorNavigationTop');
        const bottomControls=el('projectEditorNavigationBottom');
        const container=el('dynamicContainer');
        if(!topControls||!bottomControls||!container)return;
        topControls.classList.add('hidden');
        bottomControls.classList.remove('hidden');
        const controlsHeight=bottomControls.getBoundingClientRect().height;
        const contentHeight=container.scrollHeight;
        const availableHeight=Math.max(0,window.innerHeight-container.getBoundingClientRect().top);
        const pageIsLong=(contentHeight-controlsHeight)>availableHeight;
        topControls.classList.toggle('hidden',!pageIsLong);
        bottomControls.classList.toggle('hidden',pageIsLong);
    }

    async function backFromProjectEditor(){
        if(history.length)return open(history.pop(),{push:false});
        currentId=null;
        localStorage.setItem('nextTaskProjectPlannerUi',JSON.stringify({view:'projects-list'}));
        return window.ProjectPlanner?.open?.();
    }

    window.addEventListener('resize',()=>requestAnimationFrame(positionProjectEditorNavigation));

    async function undoLast(){const entry=getUndo();if(!entry)return;try{if(entry.snapshot?.length)await restore(entry.snapshot);if(entry.deleteIds?.length){for(const id of entry.deleteIds)await removeNode(id,'subtree');}clearUndo();await open(entry.returnId||currentId,{push:false});}catch(error){alert(`Undo failed: ${error.message}`);}}

    async function open(projectId,options={}){
        try{
            if(!projectId)return;
            if(options.push!==false&&currentId&&currentId!==projectId)history.push(currentId);
            currentId=projectId;
            const {node,children}=await getNode(projectId);
            if(node.node_type!=='project')throw new Error('Only projects can be opened in the project editor.');
            const tasks=children.filter(c=>c.node_type!=='project');
            const projects=children.filter(c=>c.node_type==='project');
            const c=shell();
            const navigationButtons=()=>`${getUndo()?'<button class="projectEditorUndo">Undo Last Change</button>':''}<button class="projectEditorBack">Back</button>`;
            c.innerHTML=`<h2>${esc(node.name)}</h2><p>${minutes(node.estimated_ms)} min estimated</p>
                <div id="projectEditorNavigationTop" class="hidden">${navigationButtons()}</div>
                <h3 id="projectEditorTasksHeading">Tasks</h3><div id="projectEditorTasks"></div>
                <h3>Projects</h3><div id="projectEditorProjects"></div>
                <div class="planner-choice-grid"><button id="projectEditorGroup">Group Selected</button><button id="projectEditorMoveSelected">Move Selected</button><button id="projectEditorAddTask">Add Task</button><button id="projectEditorAddProject">Add Subproject</button></div>
                <div id="projectEditorNavigationBottom">${navigationButtons()}</div>`;
            renderRows(el('projectEditorTasks'),tasks,node,false);
            renderRows(el('projectEditorProjects'),projects,node,true);
            if(!tasks.length)el('projectEditorTasks').innerHTML='<p>No loose tasks at this level.</p>';
            if(!projects.length)el('projectEditorProjects').innerHTML='<p>No subprojects at this level.</p>';
            el('projectEditorGroup').onclick=()=>showGroup(node);
            el('projectEditorMoveSelected').onclick=()=>showMoveSelected(node);
            el('projectEditorAddTask').onclick=()=>showAddTask(node);
            el('projectEditorAddProject').onclick=()=>showAddProject(node);
            document.querySelectorAll('.projectEditorUndo').forEach(button=>button.onclick=undoLast);
            document.querySelectorAll('.projectEditorBack').forEach(button=>button.onclick=backFromProjectEditor);
            requestAnimationFrame(positionProjectEditorNavigation);
        }catch(error){console.error(error);const c=shell();c.innerHTML=`<h2>Project Editor</h2><p>${esc(error.message||'Could not open project.')}</p><button id="projectEditorErrorBack">Back</button>`;el('projectEditorErrorBack').onclick=()=>history.length?open(history.pop(),{push:false}):window.ProjectPlanner?.open?.();}
    }

    function renderRows(container,items,parent,isProject){
        items.forEach(item=>{const row=document.createElement('div');row.className=isProject?'planner-project-row':'planner-order-row';row.innerHTML=`<label class="planner-check"><input class="projectEditorSelect" type="checkbox" value="${esc(item.id)}"><span></span></label>`;const span=row.querySelector('span');
            if(isProject){const link=document.createElement('button');link.className='planner-project-link';link.textContent=item.name;link.onclick=()=>open(item.id);span.appendChild(link);span.append(` — ${minutes(item.estimated_ms)} min`);}else span.textContent=`${item.name} — ${minutes(item.estimated_ms)} min`;
            const move=document.createElement('button');move.textContent='Move';move.onclick=()=>showMove(item,parent);
            const del=document.createElement('button');del.textContent='Delete';del.onclick=()=>showDelete(item,parent);
            row.append(move,del);
            if(isProject){const ungroup=document.createElement('button');ungroup.textContent='Ungroup';ungroup.onclick=()=>ungroupProject(item,parent);row.appendChild(ungroup);}
            container.appendChild(row);});
    }
    function selectedIds(){return Array.from(document.querySelectorAll('.projectEditorSelect:checked')).map(i=>i.value);}

    async function showMove(item,parent){try{const projects=flattenProjects(await tree()).filter(p=>p.id!==item.id);const c=shell();c.innerHTML=`<h2>Move ${esc(item.name)}</h2><p>Choose a destination.</p><div id="moveDestinations" class="planner-list"></div><button id="moveBack">Back</button>`;const list=el('moveDestinations');const add=(label,id)=>{const b=document.createElement('button');b.textContent=label;b.onclick=async()=>{try{const result=await reparent(item.id,id);setUndo({snapshot:result.undo,returnId:parent.id});open(parent.id,{push:false});}catch(e){alert(e.message);}};list.appendChild(b);};add('Uncategorized Backlog',null);projects.forEach(p=>add(p.name,p.id));el('moveBack').onclick=()=>open(parent.id,{push:false});}catch(error){alert(error.message);}}

    async function showMoveSelected(parent){const ids=selectedIds();if(!ids.length)return alert('Select at least one task or project.');try{const projects=flattenProjects(await tree());const c=shell();c.innerHTML=`<h2>Move Selected</h2><div id="moveSelectedDestinations" class="planner-list"></div><button id="moveSelectedBack">Back</button>`;const list=el('moveSelectedDestinations');const add=(label,id)=>{const b=document.createElement('button');b.textContent=label;b.onclick=async()=>{try{const snapshot=[];for(const nodeId of ids){const result=await reparent(nodeId,id);snapshot.push(...(result.undo||[]));}setUndo({snapshot,returnId:parent.id});open(parent.id,{push:false});}catch(e){alert(e.message);}};list.appendChild(b);};add('Uncategorized Backlog',null);projects.filter(p=>!ids.includes(p.id)).forEach(p=>add(p.name,p.id));el('moveSelectedBack').onclick=()=>open(parent.id,{push:false});}catch(error){alert(error.message);}}

    function showGroup(parent){const ids=selectedIds();if(ids.length<2)return alert('Select at least two items to group.');const c=shell();c.innerHTML=`<h2>Group Selected</h2><label>New subproject name<input id="groupName"></label><button id="groupSave">Create Group</button><button id="groupBack">Back</button>`;el('groupSave').onclick=async()=>{const name=el('groupName').value.trim();if(!name)return alert('Give the group a name.');try{const group=await createNode({name,nodeType:'project',parentId:parent.id,independentlyActionable:false,sessionId});const snapshot=[];for(const id of ids){const result=await reparent(id,group.id);snapshot.push(...(result.undo||[]));}setUndo({snapshot,deleteIds:[group.id],returnId:parent.id});open(parent.id,{push:false});}catch(error){alert(error.message);}};el('groupBack').onclick=()=>open(parent.id,{push:false});}

    async function ungroupProject(item,parent){try{const result=await removeNode(item.id,'ungroup');setUndo({snapshot:result.undo,returnId:parent.id});open(parent.id,{push:false});}catch(error){alert(error.message);}}

    async function showDelete(item,parent){const {children}=await getNode(item.id);if(item.node_type==='project'&&children.length){const c=shell();c.innerHTML=`<h2>Delete ${esc(item.name)}?</h2><p>This project contains ${children.length} direct item${children.length===1?'':'s'}.</p><div class="planner-choice-grid"><button id="deleteAll">Delete Project & Contents</button><button id="deleteUngroup">Keep Contents / Ungroup</button></div><button id="deleteBack">Back</button>`;el('deleteAll').onclick=()=>performDelete(item,parent,'subtree');el('deleteUngroup').onclick=()=>performDelete(item,parent,'ungroup');el('deleteBack').onclick=()=>open(parent.id,{push:false});return;}if(confirm(`Delete “${item.name}”?`))performDelete(item,parent,'subtree');}
    async function performDelete(item,parent,mode){try{const result=await removeNode(item.id,mode);setUndo({snapshot:result.undo,returnId:parent.id});open(parent.id,{push:false});}catch(error){alert(error.message);}}

    function showAddTask(parent){
        const c=shell();
        c.innerHTML=`<h2>Add Task to ${esc(parent.name)}</h2><label>Task name<input id="projectEditorTaskName"></label><label>Estimated time<input id="projectEditorTaskMinutes" type="number" min="1" placeholder="Minutes"></label><button id="projectEditorTaskNext">Choose Position</button><button id="projectEditorTaskCancel">Back</button>`;
        el('projectEditorTaskNext').onclick=async()=>{
            const name=el('projectEditorTaskName').value.trim();
            const mins=parseInt(el('projectEditorTaskMinutes').value,10);
            if(!name)return alert('Please enter a task name.');
            if(!Number.isFinite(mins)||mins<1)return alert('Please enter an estimate in minutes.');
            try{
                const {children}=await getNode(parent.id);
                showTaskInsertion(parent,{name,mins},children);
            }catch(error){alert(error.message);}
        };
        el('projectEditorTaskCancel').onclick=()=>open(parent.id,{push:false});
    }

    function showTaskInsertion(parent,draft,children){
        const ordered=[...(children||[])].sort((a,b)=>(Number(a.position||0)-Number(b.position||0))||(Number(a.created||0)-Number(b.created||0)));
        const c=shell();
        c.innerHTML=`<h2>Where should this task go?</h2><p class="planner-moving">${esc(draft.name)} — ${draft.mins} min</p><div id="projectEditorInsertSlots" class="planner-list"></div><button id="projectEditorInsertBack">Back</button>`;
        const list=el('projectEditorInsertSlots');
        for(let i=0;i<=ordered.length;i++){
            const button=document.createElement('button');
            button.textContent=i===ordered.length?'Add at end':`Add before ${ordered[i].name}`;
            button.onclick=async()=>{
                button.disabled=true;
                try{
                    for(let j=ordered.length-1;j>=i;j--){
                        await updateNode(ordered[j].id,{position:Number(ordered[j].position||j+1)+1});
                    }
                    await createNode({name:draft.name,nodeType:'task',parentId:parent.id,position:i+1,estimatedTimeMs:draft.mins*60000,sessionId});
                    open(parent.id,{push:false});
                }catch(error){
                    alert(error.message);
                    button.disabled=false;
                }
            };
            list.appendChild(button);
        }
        el('projectEditorInsertBack').onclick=()=>showAddTask(parent);
    }

    function showAddProject(parent){const c=shell();c.innerHTML=`<h2>Add Subproject to ${esc(parent.name)}</h2><label>Project name<input id="projectEditorProjectName"></label><label>Estimated time<input id="projectEditorProjectMinutes" type="number" min="1" placeholder="Minutes"></label><button id="projectEditorProjectSave">Add Subproject</button><button id="projectEditorProjectCancel">Back</button>`;el('projectEditorProjectSave').onclick=async()=>{const name=el('projectEditorProjectName').value.trim(),mins=parseInt(el('projectEditorProjectMinutes').value,10);if(!name)return alert('Please enter a project name.');if(!Number.isFinite(mins)||mins<1)return alert('Please enter an estimate in minutes.');try{const child=await createNode({name,nodeType:'project',parentId:parent.id,estimatedTimeMs:mins*60000,independentlyActionable:false,sessionId});await open(child.id);}catch(error){alert(error.message);}};el('projectEditorProjectCancel').onclick=()=>open(parent.id,{push:false});}

    document.addEventListener('click',async event=>{const link=event.target.closest?.('.planner-project-link');if(!link||link.closest('#projectEditorProjects'))return;const allLinks=Array.from(document.querySelectorAll('#projectList .planner-project-link'));const index=allLinks.indexOf(link);if(index<0)return;event.preventDefault();event.stopImmediatePropagation();try{const projects=(await roots()).filter(n=>n.node_type==='project'&&!['completed','cancelled'].includes(n.status));if(projects[index]){history.length=0;currentId=null;await open(projects[index].id,{push:false});}}catch(error){console.error('Could not open recursive project editor:',error);}},true);

    return {open};
})();
