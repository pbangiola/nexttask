'use strict';

window.ProjectPlanner = (() => {
    const UI_STATE_KEY = 'nextTaskProjectPlannerUi';
    const PROJECT_THRESHOLD_MINUTES = 20;

    let view = 'planner-home';
    let currentProjectId = null;
    let currentParentId = null;
    let activeNodeId = null;
    let pendingHasParts = false;
    let returnTarget = 'planner-home';
    let seedBacklogId = null;
    let pendingBacklogIds = [];
    let backlogUndoSnapshot = null;

    const makeId = prefix => `${prefix}_${globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2, 11)}`;
    const esc = value => String(value ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');

    function saveUi() {
        localStorage.setItem(UI_STATE_KEY, JSON.stringify({
            view, currentProjectId, currentParentId, activeNodeId,
            pendingHasParts, returnTarget, seedBacklogId, pendingBacklogIds
        }));
    }
    function loadUi() {
        try {
            const state = JSON.parse(localStorage.getItem(UI_STATE_KEY) || '{}');
            view = state.view || 'planner-home';
            currentProjectId = state.currentProjectId || null;
            currentParentId = state.currentParentId || null;
            activeNodeId = state.activeNodeId || null;
            pendingHasParts = Boolean(state.pendingHasParts);
            returnTarget = state.returnTarget || 'planner-home';
            seedBacklogId = state.seedBacklogId || null;
            pendingBacklogIds = Array.isArray(state.pendingBacklogIds) ? state.pendingBacklogIds : [];
        } catch (error) { console.warn('Planner UI state could not be restored:', error); }
    }

    function clearShell() {
        hideStaticScreens();
        hide(el('stopWorkingBtn'));
        hide(el('startOverBtn'));
        hide(el('taskCompare'));
        return clearDynamic();
    }
    function fail(error, back) {
        console.error(error);
        const c = clearShell();
        c.innerHTML = `<h2>Project Planner</h2><p>${esc(error?.message || 'Something went wrong.')}</p><button id="plannerErrorBack">Back</button>`;
        el('plannerErrorBack').onclick = back || showPlannerHome;
    }

    async function api(path, options = {}) {
        const response = await fetch(`${API_BASE_URL}/api/users/${encodeURIComponent(userId)}${path}`, {
            ...options,
            headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
        });
        let body = null;
        try { body = await response.json(); } catch (_) {}
        if (!response.ok) throw new Error(body?.error || `Planner request failed (${response.status})`);
        return body;
    }
    async function roots() { return (await api('/nodes')).nodes || []; }
    async function tree() { return (await api('/nodes?tree=1')).nodes || []; }
    async function getNode(id) { return api(`/nodes/${encodeURIComponent(id)}`); }
    async function createNode(input) {
        return (await api('/nodes', { method:'POST', body:JSON.stringify({ id:input.id || makeId(input.nodeType === 'project' ? 'project' : 'task'), ...input }) })).node;
    }
    async function updateNode(id, input) {
        return (await api(`/nodes/${encodeURIComponent(id)}`, { method:'PUT', body:JSON.stringify(input) })).node;
    }
    async function reparent(id, parentId, position) {
        return (await api(`/nodes/${encodeURIComponent(id)}/parent`, { method:'PUT', body:JSON.stringify({ parentId, position }) })).node;
    }
    async function deleteNode(id) {
        return api(`/nodes/${encodeURIComponent(id)}`, { method:'DELETE' });
    }
    async function undoSnapshot(snapshot) {
        return api('/nodes/undo', { method:'POST', body:JSON.stringify({ snapshot }) });
    }

    function openRootTasks(nodes) {
        return nodes.filter(n => n.node_type !== 'project' && !['completed','cancelled'].includes(n.status) && String(n.name).toLowerCase() !== 'sort tasks');
    }
    function openRootProjects(nodes) {
        return nodes.filter(n => n.node_type === 'project' && !['completed','cancelled'].includes(n.status));
    }
    function findInTree(nodes, id) {
        for (const node of nodes) {
            if (node.id === id) return node;
            const found = findInTree(node.children || [], id);
            if (found) return found;
        }
        return null;
    }
    function leafStats(node) {
        if (!node?.children?.length) return { ms:Number(node?.estimated_ms || 0), steps:node?.node_type === 'project' ? 0 : 1 };
        return node.children.reduce((acc, child) => { const s=leafStats(child); acc.ms+=s.ms; acc.steps+=s.steps; return acc; }, {ms:0,steps:0});
    }

    async function open() {
        loadUi();
        try {
            if (view === 'review-entry') return showReviewEntry();
            if (view === 'backlog-list') return showBacklogList();
            if (view === 'backlog-delete') return showBacklogDelete();
            if (view === 'backlog-membership' && seedBacklogId) return showMembership(seedBacklogId);
            if (view === 'backlog-related' && seedBacklogId) return showRelated(seedBacklogId);
            if (view === 'projects-list') return showProjects();
            if (view === 'define-project') return showDefineProject();
            if (view === 'parts-entry' && currentParentId) return showPartsEntry(currentParentId);
            if (view === 'estimate-task' && activeNodeId) return showEstimate(activeNodeId);
            if (view === 'reorder-task' && activeNodeId) return showReorder(activeNodeId, pendingHasParts);
            if (view === 'subproject-callout' && activeNodeId) return showSubprojectCallout(activeNodeId);
            if (view === 'summary' && currentProjectId) return showSummary(currentProjectId);
            showPlannerHome();
        } catch (error) { fail(error, showPlannerHome); }
    }

    function showPlannerHome() {
        view='planner-home'; currentParentId=null; activeNodeId=null;
        const c=clearShell();
        c.innerHTML=`<h2>Project Planner</h2><p>What would you like to do?</p><div class="planner-choice-grid"><button id="plannerCreate">Create a Project<span>I know what I want to accomplish.</span></button><button id="plannerReview">Review Your Existing Backlog<span>Sort, delete, or find work that belongs together.</span></button></div><button id="plannerExit">Back to Task Sorter</button>`;
        el('plannerCreate').onclick=()=>{currentProjectId=null;pendingBacklogIds=[];returnTarget='planner-home';showDefineProject();};
        el('plannerReview').onclick=showReviewEntry;
        el('plannerExit').onclick=()=>{view='planner-home';saveUi();showModeSelect();};
        saveUi();
    }

    function showReviewEntry() {
        view='review-entry';
        const c=clearShell();
        c.innerHTML=`<h2>Project Planner</h2><p>What would you like to review?</p><div class="planner-choice-grid"><button id="reviewBacklog">Uncategorized Backlog<span>Sort, delete, or group tasks.</span></button><button id="reviewProjects">Existing Projects<span>View or edit projects you already created.</span></button></div><button id="reviewBack">Back</button>`;
        el('reviewBacklog').onclick=showBacklogList; el('reviewProjects').onclick=showProjects; el('reviewBack').onclick=showPlannerHome; saveUi();
    }

    async function showBacklogList() {
        try {
            view='backlog-list';
            const items=openRootTasks(await roots());
            const c=clearShell();
            c.innerHTML=`<h2>Uncategorized Backlog</h2><p>${items.length} task${items.length===1?'':'s'}.</p><div class="planner-choice-grid"><button id="backlogSort">Sort Backlog<span>Use forced choices to set the order.</span></button><button id="backlogDelete">Delete Tasks<span>Remove work you no longer need.</span></button></div><h3>Tasks</h3><div id="backlogLinks" class="planner-list"></div><button id="backlogBack">Back</button>`;
            const list=el('backlogLinks');
            if(!items.length) list.innerHTML='<p>There are no uncategorized tasks in your backlog.</p>';
            items.forEach(item=>{const b=document.createElement('button');b.textContent=item.name;b.title='Review this task for project grouping';b.onclick=()=>showMembership(item.id);list.appendChild(b);});
            el('backlogSort').disabled=items.length<2;
            el('backlogSort').onclick=()=>sortBacklog(items);
            el('backlogDelete').disabled=!items.length;
            el('backlogDelete').onclick=showBacklogDelete;
            el('backlogBack').onclick=showReviewEntry;
            saveUi();
        } catch(error){fail(error,showReviewEntry);}
    }

    async function sortBacklog(items) {
        try {
            clearDynamic();
            show(el('taskCompare'));
            const runId=++sortRunId;
            const sorted=await interactiveMergeSort([...items],runId);
            hide(el('taskCompare'));
            if(runId!==sortRunId)return;
            for(let i=0;i<sorted.length;i++) await updateNode(sorted[i].id,{position:i+1});
            showBacklogList();
        } catch(error){hide(el('taskCompare'));fail(error,showBacklogList);}
    }

    async function showBacklogDelete() {
        try {
            view='backlog-delete';
            const items=openRootTasks(await roots());
            const c=clearShell();
            c.innerHTML=`<h2>Delete Tasks</h2><p>Delete anything you no longer need.</p><div id="deleteBacklogList" class="planner-list"></div><button id="undoBacklogDelete">Undo Last Delete</button><button id="deleteBacklogBack">Back</button>`;
            const list=el('deleteBacklogList');
            if(!items.length) list.innerHTML='<p>There are no uncategorized tasks to delete.</p>';
            items.forEach(item=>{
                const row=document.createElement('div');
                row.className='planner-project-row';
                const name=document.createElement('span');
                name.textContent=item.name;
                name.style.fontSize='16px';
                name.style.color='inherit';
                const button=document.createElement('button');
                button.textContent='Delete';
                button.onclick=async()=>{
                    if(!confirm(`Delete “${item.name}”?`))return;
                    button.disabled=true;
                    try{
                        const result=await deleteNode(item.id);
                        backlogUndoSnapshot=result.undo || null;
                        showBacklogDelete();
                    }catch(error){fail(error,showBacklogDelete);}
                };
                row.append(name,button);
                list.appendChild(row);
            });
            const undo=el('undoBacklogDelete');
            undo.disabled=!backlogUndoSnapshot;
            undo.onclick=async()=>{
                if(!backlogUndoSnapshot)return;
                const snapshot=backlogUndoSnapshot;
                undo.disabled=true;
                try{await undoSnapshot(snapshot);backlogUndoSnapshot=null;showBacklogDelete();}
                catch(error){fail(error,showBacklogDelete);}
            };
            el('deleteBacklogBack').onclick=showBacklogList;
            saveUi();
        } catch(error){fail(error,showBacklogList);}
    }

    async function showMembership(id) {
        try {
            const {node}=await getNode(id); seedBacklogId=id; view='backlog-membership'; const c=clearShell();
            c.innerHTML=`<h2>${esc(node.name)}</h2><p><strong>Is this part of a project?</strong></p><div class="planner-choice-grid"><button id="memberYes">Yes</button><button id="memberNo">No</button></div><button id="memberBack">Back</button>`;
            el('memberYes').onclick=()=>showRelated(id); el('memberNo').onclick=showBacklogList; el('memberBack').onclick=showBacklogList; saveUi();
        } catch(error){fail(error,showBacklogList);}
    }

    async function showRelated(id) {
        try {
            const [{node:seed},allRoots]=await Promise.all([getNode(id),roots()]); const choices=openRootTasks(allRoots).filter(n=>n.id!==id); seedBacklogId=id; view='backlog-related'; const c=clearShell();
            c.innerHTML=`<h2>${esc(seed.name)}</h2><p><strong>What other work belongs with this?</strong></p><div id="relatedChecklist"></div><button id="relatedContinue">Create a Project</button><button id="relatedBack">Back</button>`;
            const checks=el('relatedChecklist'); choices.forEach(item=>{const l=document.createElement('label');l.className='planner-check';l.innerHTML=`<input type="checkbox" value="${esc(item.id)}"><span>${esc(item.name)}</span>`;checks.appendChild(l);});
            el('relatedContinue').onclick=()=>{pendingBacklogIds=[id,...Array.from(checks.querySelectorAll('input:checked')).map(i=>i.value)];currentProjectId=null;returnTarget='backlog-list';showDefineProject();};
            el('relatedBack').onclick=()=>showMembership(id); saveUi();
        } catch(error){fail(error,showBacklogList);}
    }

    async function showProjects() {
        try {
            view='projects-list'; const [rootNodes,fullTree]=await Promise.all([roots(),tree()]); const projects=openRootProjects(rootNodes); const c=clearShell();
            c.innerHTML=`<h2>Existing Projects</h2><div id="projectList"></div><div class="planner-choice-grid"><button id="addProject">Add New Project</button><button id="combineProjects">Combine Projects</button></div><button id="projectsBack">Back</button>`;
            const list=el('projectList'); if(!projects.length) list.innerHTML='<p>No projects yet.</p>';
            projects.forEach(item=>{const full=findInTree(fullTree,item.id);const s=leafStats(full);const row=document.createElement('div');row.className='planner-project-row';const link=document.createElement('button');link.className='planner-project-link';link.textContent=item.name;link.onclick=()=>showSummary(item.id);const meta=document.createElement('span');meta.textContent=`${Math.round(s.ms/60000)} min • ${s.steps} steps • Click to view or edit`;row.append(link,meta);list.appendChild(row);});
            el('addProject').onclick=()=>{currentProjectId=null;pendingBacklogIds=[];returnTarget='projects-list';showDefineProject();};
            el('combineProjects').onclick=showCombineProjects; el('projectsBack').onclick=showReviewEntry; saveUi();
        } catch(error){fail(error,showReviewEntry);}
    }

    async function showCombineProjects() {
        try {
            const projects=openRootProjects(await roots()); view='projects-list'; const c=clearShell();
            c.innerHTML=`<h2>Combine Projects</h2><p>Choose the first project.</p><div id="combineList" class="planner-list"></div><button id="combineBack">Back</button>`;
            const list=el('combineList'); projects.forEach(seed=>{const b=document.createElement('button');b.textContent=seed.name;b.onclick=async()=>{const fresh=openRootProjects(await roots());const panel=clearShell();panel.innerHTML=`<h2>${esc(seed.name)}</h2><p>What other projects belong with this?</p><div id="combineChecks"></div><button id="combineContinue">Create Parent Project</button><button id="combineCancel">Back</button>`;const checks=el('combineChecks');fresh.filter(p=>p.id!==seed.id).forEach(p=>{const l=document.createElement('label');l.className='planner-check';l.innerHTML=`<input type="checkbox" value="${esc(p.id)}"><span>${esc(p.name)}</span>`;checks.appendChild(l);});el('combineContinue').onclick=()=>{pendingBacklogIds=[seed.id,...Array.from(checks.querySelectorAll('input:checked')).map(i=>i.value)];if(pendingBacklogIds.length<2)return alert('Choose at least one other project.');currentProjectId=null;returnTarget='projects-list';showDefineProject();};el('combineCancel').onclick=showCombineProjects;};list.appendChild(b);});
            el('combineBack').onclick=showProjects; saveUi();
        } catch(error){fail(error,showProjects);}
    }

    async function showDefineProject() {
        try {
            view='define-project'; let existing=null; if(currentProjectId) existing=(await getNode(currentProjectId)).node; const c=clearShell();
            c.innerHTML=`<h2>${pendingBacklogIds.length?'These belong together.':'Create a Project'}</h2><label>${pendingBacklogIds.length?'What should we call this project?':'What are you working on?'}<input id="projectName"></label><label>About how long do you think the whole project will take?<input id="projectEstimate" type="number" min="1" placeholder="Minutes"></label><button id="projectContinue">Continue</button><button id="projectBack">Back</button>`;
            if(existing){el('projectName').value=existing.name||'';el('projectEstimate').value=existing.estimated_ms?Math.round(existing.estimated_ms/60000):'';}
            el('projectContinue').onclick=async()=>{try{const name=el('projectName').value.trim();const minutes=parseInt(el('projectEstimate').value,10);if(!name)return alert('Please give the project a name.');if(!Number.isFinite(minutes)||minutes<1)return alert('Please enter your best estimate in minutes.');let root;if(currentProjectId)root=await updateNode(currentProjectId,{name,nodeType:'project',estimatedTimeMs:minutes*60000,independentlyActionable:false});else{root=await createNode({name,nodeType:'project',estimatedTimeMs:minutes*60000,independentlyActionable:false,sessionId});currentProjectId=root.id;}currentParentId=root.id;if(pendingBacklogIds.length){for(let i=0;i<pendingBacklogIds.length;i++)await reparent(pendingBacklogIds[i],root.id,i+1);pendingBacklogIds=[];}saveUi();showPartsEntry(root.id);}catch(error){fail(error,showDefineProject);}};
            el('projectBack').onclick=()=>returnTarget==='backlog-list'?showBacklogList():returnTarget==='projects-list'?showProjects():showPlannerHome(); saveUi();
        } catch(error){fail(error,showPlannerHome);}
    }

    async function showPartsEntry(parentId) {
        try {
            currentParentId=parentId;view='parts-entry';const {node:parent,children}=await getNode(parentId);const c=clearShell();
            c.innerHTML=`<h2>${esc(parent.name)}</h2><p>What are all the parts of this project you can think of?</p><textarea id="partsText" rows="10"></textarea><label class="planner-check"><input id="partsSkipSort" type="checkbox"><span>Keep this order (skip comparison sorting)</span></label><button id="partsContinue">Continue</button><div class="upload-container"><input id="partsUpload" type="file" accept=".txt,.csv,text/plain,text/csv"></div><button id="partsBack">Back</button>`;
            el('partsText').value=children.map(child=>child.name).join('\n');
            el('partsUpload').onchange=e=>{const file=e.target.files?.[0];if(!file)return;const r=new FileReader();r.onload=x=>{el('partsText').value=parseTaskEntryText(String(x.target.result||'')).join('\n');};r.readAsText(file);};
            el('partsContinue').onclick=async()=>{try{const names=resolveDuplicateTaskNames(parseTaskEntryText(el('partsText').value));if(!names.length)return alert('Please add at least one part.');const byName=new Map(children.map(child=>[child.name,child]));const nodes=[];for(const name of names){let node=byName.get(name);if(!node)node=await createNode({name,nodeType:'task',parentId,sessionId});nodes.push(node);}if(el('partsSkipSort').checked){for(let i=0;i<nodes.length;i++)await updateNode(nodes[i].id,{position:i+1});showEstimate(nodes[0].id);return;}await sortPlannerNodes(nodes);showEstimate(nodes[0].id);}catch(error){fail(error,()=>showPartsEntry(parentId));}};
            el('partsBack').onclick=()=>showSummary(currentProjectId); saveUi();
        } catch(error){fail(error,showProjects);}
    }

    async function sortPlannerNodes(nodes) {
        clearDynamic();
        show(el('taskCompare'));
        const runId=++sortRunId;
        const sorted=await interactiveMergeSort(nodes,runId);
        hide(el('taskCompare'));
        for(let i=0;i<sorted.length;i++) await updateNode(sorted[i].id,{position:i+1});
        clearDynamic();
    }

    async function showEstimate(nodeId) {
        try {
            const {node}=await getNode(nodeId); activeNodeId=nodeId; view='estimate-task'; const c=clearShell();
            c.innerHTML=`<h2>${esc(node.name)}</h2><label>How long do you think this will take?<input id="nodeEstimate" type="number" min="1" placeholder="Minutes"></label><label class="planner-check"><input id="nodeOutOfOrder" type="checkbox"><span>This task is out of order</span></label><label class="planner-check"><input id="nodeHasParts" type="checkbox"><span>This task has parts</span></label><button id="estimateContinue">Continue</button><button id="estimateBack">Back</button>`;
            if(node.estimated_ms)el('nodeEstimate').value=Math.round(node.estimated_ms/60000);
            el('estimateContinue').onclick=async()=>{try{const minutes=parseInt(el('nodeEstimate').value,10);if(!Number.isFinite(minutes)||minutes<1)return alert('Enter an estimate in minutes.');const hasParts=el('nodeHasParts').checked;const outOfOrder=el('nodeOutOfOrder').checked;await updateNode(nodeId,{estimatedTimeMs:minutes*60000});pendingHasParts=hasParts;if(outOfOrder)return showReorder(nodeId,hasParts);if(hasParts)return convertToSubproject(nodeId);if(minutes>PROJECT_THRESHOLD_MINUTES)return showSubprojectCallout(nodeId);advanceEstimate(node.parent_id,nodeId);}catch(error){fail(error,()=>showEstimate(nodeId));}};
            el('estimateBack').onclick=()=>showPartsEntry(node.parent_id); saveUi();
        } catch(error){fail(error,()=>showPartsEntry(currentParentId));}
    }

    async function advanceEstimate(parentId,currentId) {
        const {children}=await getNode(parentId);const idx=children.findIndex(child=>child.id===currentId);const next=children.slice(idx+1).find(child=>!child.estimated_ms);if(next)return showEstimate(next.id);if(parentId===currentProjectId)return showSummary(currentProjectId);const parent=(await getNode(parentId)).node;return advanceEstimate(parent.parent_id,parent.id);
    }

    async function showReorder(nodeId,hasParts) {
        try {
            const {node}=await getNode(nodeId);const {children}=await getNode(node.parent_id);view='reorder-task';const c=clearShell();c.innerHTML=`<h2>Where should this task go?</h2><div id="orderList"></div><div class="planner-moving">${esc(node.name)}</div><button id="orderBack">Back</button>`;const list=el('orderList');const others=children.filter(ch=>ch.id!==nodeId);for(let i=0;i<=others.length;i++){const b=document.createElement('button');b.textContent=i===others.length?'Move to end':`Move before ${others[i].name}`;b.onclick=async()=>{for(let j=0;j<others.length;j++)await updateNode(others[j].id,{position:j+(j>=i?2:1)});await updateNode(nodeId,{position:i+1});if(hasParts)return convertToSubproject(nodeId);const mins=Math.round(Number(node.estimated_ms||0)/60000);if(mins>PROJECT_THRESHOLD_MINUTES)return showSubprojectCallout(nodeId);advanceEstimate(node.parent_id,nodeId);};list.appendChild(b);}el('orderBack').onclick=()=>showEstimate(nodeId);saveUi();
        } catch(error){fail(error,()=>showEstimate(nodeId));}
    }

    async function showSubprojectCallout(nodeId) {
        try {
            const {node}=await getNode(nodeId);view='subproject-callout';const c=clearShell();c.innerHTML=`<div class="planner-callout"><h2>This may be a project</h2><p>${esc(node.name)}</p><p>Estimated time: ${Math.round(node.estimated_ms/60000)} minutes</p><div class="planner-choice-grid"><button id="breakParts">Break Into Parts</button><button id="keepTask">Keep As One Task</button></div></div>`;el('breakParts').onclick=()=>convertToSubproject(nodeId);el('keepTask').onclick=()=>advanceEstimate(node.parent_id,nodeId);saveUi();
        } catch(error){fail(error,()=>showEstimate(nodeId));}
    }

    async function convertToSubproject(nodeId) { try { const node=await updateNode(nodeId,{nodeType:'project',independentlyActionable:false}); currentParentId=node.id; showPartsEntry(node.id); } catch(error){fail(error,()=>showEstimate(nodeId));} }

    async function showSummary(projectId) {
        try {
            currentProjectId=projectId;view='summary';const full=findInTree(await tree(),projectId);if(!full)return showProjects();const s=leafStats(full);const c=clearShell();c.innerHTML=`<h2>${esc(full.name)}</h2><p>Initial estimate: ${Math.round(Number(full.estimated_ms||0)/60000)} minutes</p><p>Planned estimate: ${Math.round(s.ms/60000)} minutes</p><div id="summaryTree"></div><div class="planner-choice-grid"><button id="editProject">Edit Project</button><button id="summaryDone">Done</button></div>`;const render=(node,depth=0)=>{const div=document.createElement('div');div.style.marginLeft=`${depth*20}px`;div.textContent=`${node.name}${node.children?.length?'':` — ${Math.round(Number(node.estimated_ms||0)/60000)} min`}`;el('summaryTree').appendChild(div);(node.children||[]).forEach(ch=>render(ch,depth+1));};(full.children||[]).forEach(ch=>render(ch));el('editProject').onclick=()=>showPartsEntry(projectId);el('summaryDone').onclick=()=>returnTarget==='backlog-list'?showBacklogList():returnTarget==='projects-list'?showProjects():showPlannerHome();saveUi();
        } catch(error){fail(error,showProjects);}
    }

    return { open };
})();
