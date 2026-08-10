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
        c.innerHTML=`<h2>Project Planner</h2><p>What would you like to do?</p><div class="planner-choice-grid"><button id="plannerCreate">Create a Project<span>I know what I want to accomplish.</span></button><button id="plannerReview">Review Your Existing Backlog<span>Find work that belongs together.</span></button></div><button id="plannerExit">Back to Task Sorter</button>`;
        el('plannerCreate').onclick=()=>{currentProjectId=null;pendingBacklogIds=[];returnTarget='planner-home';showDefineProject();};
        el('plannerReview').onclick=showReviewEntry;
        el('plannerExit').onclick=()=>{view='planner-home';saveUi();showModeSelect();};
        saveUi();
    }

    function showReviewEntry() {
        view='review-entry';
        const c=clearShell();
        c.innerHTML=`<h2>Project Planner</h2><p>What would you like to review?</p><div class="planner-choice-grid"><button id="reviewBacklog">Uncategorized Backlog<span>Look for tasks that belong to projects.</span></button><button id="reviewProjects">Existing Projects<span>View or edit projects you already created.</span></button></div><button id="reviewBack">Back</button>`;
        el('reviewBacklog').onclick=showBacklogList; el('reviewProjects').onclick=showProjects; el('reviewBack').onclick=showPlannerHome; saveUi();
    }

    async function showBacklogList() {
        try {
            view='backlog-list'; const items=openRootTasks(await roots()); const c=clearShell();
            c.innerHTML=`<h2>Uncategorized Backlog</h2><p>Choose a task to review.</p><div id="backlogLinks" class="planner-list"></div><button id="backlogBack">Back</button>`;
            const list=el('backlogLinks'); if(!items.length) list.innerHTML='<p>There are no uncategorized tasks in your backlog.</p>';
            items.forEach(item=>{const b=document.createElement('button');b.textContent=item.name;b.onclick=()=>showMembership(item.id);list.appendChild(b);});
            el('backlogBack').onclick=showReviewEntry; saveUi();
        } catch(error){fail(error,showReviewEntry);}
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
            el('partsContinue').onclick=async()=>{try{const names=resolveDuplicateTaskNames(parseTaskEntryText(el('partsText').value));if(!names.length)return alert('Please add at least one part.');const byName=new Map(children.map(ch=>[ch.name,ch]));let nodes=[];for(const name of names)nodes.push(byName.get(name)||await createNode({name,nodeType:'task',parentId,sessionId}));if(!el('partsSkipSort').checked&&nodes.length>1)nodes=await plannerSort(nodes);for(let i=0;i<nodes.length;i++)await updateNode(nodes[i].id,{position:i+1});const refreshed=(await getNode(parentId)).children;const first=refreshed.find(ch=>Number(ch.estimated_ms||0)<=0)||refreshed[0];if(first)showEstimate(first.id);else showSummary(currentProjectId);}catch(error){fail(error,()=>showPartsEntry(parentId));}};
            el('partsBack').onclick=()=>showSummary(currentProjectId);saveUi();
        } catch(error){fail(error,()=>showSummary(currentProjectId));}
    }

    function plannerSort(items) {
        const sort=async list=>{if(list.length<=1)return list;const mid=Math.floor(list.length/2);return merge(await sort(list.slice(0,mid)),await sort(list.slice(mid)));};
        const merge=(left,right)=>new Promise(resolve=>{const out=[];const next=()=>{if(!left.length||!right.length){hide(el('taskCompare'));resolve([...out,...left,...right]);return;}show(el('taskCompare'));el('task1').textContent=left[0].name;el('task2').textContent=right[0].name;el('task1').onclick=()=>{out.push(left.shift());next();};el('task2').onclick=()=>{out.push(right.shift());next();};};next();});
        return sort(items);
    }

    async function context(id){const {node}=await getNode(id);const parent=node.parent_id?(await getNode(node.parent_id)):null;return {node,parent:parent?.node||null,siblings:parent?.children||[]};}

    async function showEstimate(id) {
        try {
            activeNodeId=id;pendingHasParts=false;view='estimate-task';const {node,parent,siblings}=await context(id);const index=siblings.findIndex(n=>n.id===id);const c=clearShell();
            c.innerHTML=`<h2>${esc(parent?.name||'Project')}</h2><p>Task ${index+1} of ${siblings.length}</p><h3>${esc(node.name)}</h3><label>How long do you think this will take?<input id="taskEstimate" type="number" min="1"></label><label class="planner-check"><input id="taskOutOfOrder" type="checkbox"><span>This task is out of order</span></label><label class="planner-check"><input id="taskHasParts" type="checkbox"><span>This task has parts</span></label><button id="estimateContinue">Continue</button><button id="estimateBack">Back</button>`;
            if(node.estimated_ms)el('taskEstimate').value=Math.round(node.estimated_ms/60000);
            el('estimateContinue').onclick=async()=>{try{const minutes=parseInt(el('taskEstimate').value,10);if(!Number.isFinite(minutes)||minutes<1)return alert('Please enter your best estimate in minutes.');const outOfOrder=el('taskOutOfOrder').checked;const hasParts=el('taskHasParts').checked;await updateNode(id,{estimatedTimeMs:minutes*60000});pendingHasParts=hasParts;if(outOfOrder)return showReorder(id,hasParts);if(hasParts)return decompose(id);if(minutes>PROJECT_THRESHOLD_MINUTES)return showSubprojectCallout(id);advance(parent.id,id);}catch(error){fail(error,()=>showEstimate(id));}};
            el('estimateBack').onclick=()=>showPartsEntry(parent.id);saveUi();
        } catch(error){fail(error,()=>showPartsEntry(currentParentId));}
    }

    async function showReorder(id, hasParts) {
        try {
            activeNodeId=id;pendingHasParts=hasParts;view='reorder-task';const {node,parent,siblings}=await context(id);const others=siblings.filter(n=>n.id!==id);const c=clearShell();
            c.innerHTML=`<h2>Where should this task go?</h2><div id="reorderList"></div><div class="planner-moving"><strong>${esc(node.name)}</strong></div><button id="reorderBack">Back</button>`;
            const list=el('reorderList');const slot=(pos,label)=>{const b=document.createElement('button');b.className='planner-insert';b.textContent=label;b.onclick=async()=>{await reparent(id,parent.id,pos);if(hasParts)return decompose(id);const refreshed=(await getNode(id)).node;if(Number(refreshed.estimated_ms)>PROJECT_THRESHOLD_MINUTES)return showSubprojectCallout(id);advance(parent.id,id);};list.appendChild(b);};slot(1,'Move to beginning');others.forEach((item,i)=>{const row=document.createElement('div');row.className='planner-order-row';row.textContent=`${i+1}. ${item.name}`;list.appendChild(row);slot(i+2,`Move after ${item.name}`);});
            el('reorderBack').onclick=()=>showEstimate(id);saveUi();
        } catch(error){fail(error,()=>showEstimate(id));}
    }

    async function showSubprojectCallout(id) {
        try {
            activeNodeId=id;view='subproject-callout';const {node}=await getNode(id);const minutes=Math.round(Number(node.estimated_ms||0)/60000);const c=clearShell();
            c.innerHTML=`<div class="planner-callout"><h2>This may be a project</h2><p><strong>${esc(node.name)}</strong></p><p>Estimated time: ${minutes} minutes</p><div class="planner-choice-grid"><button id="breakTask">Break Into Parts</button><button id="keepTask">Keep As One Task</button></div></div>`;
            el('breakTask').onclick=()=>decompose(id);el('keepTask').onclick=async()=>{const fresh=(await getNode(id)).node;advance(fresh.parent_id,id);};saveUi();
        } catch(error){fail(error,()=>showEstimate(id));}
    }

    async function decompose(id){try{await updateNode(id,{nodeType:'project',independentlyActionable:false});currentParentId=id;showPartsEntry(id);}catch(error){fail(error,()=>showEstimate(id));}}
    async function advance(parentId,completedId){const siblings=(await getNode(parentId)).children;const i=siblings.findIndex(n=>n.id===completedId);if(siblings[i+1])return showEstimate(siblings[i+1].id);if(parentId!==currentProjectId){const parent=(await getNode(parentId)).node;if(parent.parent_id)return advance(parent.parent_id,parentId);}showSummary(currentProjectId);}

    async function showSummary(projectId) {
        try {
            currentProjectId=projectId;currentParentId=projectId;view='summary';const full=findInTree(await tree(),projectId);if(!full)return showProjects();const stats=leafStats(full);const render=(nodes,depth=0)=>(nodes||[]).map((n,i)=>`${'&nbsp;'.repeat(depth*4)}${i+1}. ${esc(n.name)}${n.children?.length?`<br>${render(n.children,depth+1)}`:` — ${Math.round(Number(n.estimated_ms||0)/60000)} min`}`).join('<br>');const c=clearShell();
            c.innerHTML=`<h2>${esc(full.name)}</h2><p>Initial estimate: ${Math.round(Number(full.estimated_ms||0)/60000)} minutes</p><p>Planned estimate: ${Math.round(stats.ms/60000)} minutes</p><div>${render(full.children||[])}</div><div class="planner-choice-grid"><button id="editProject">Edit Project</button><button id="summaryDone">Done</button></div>`;
            el('editProject').onclick=()=>showPartsEntry(projectId);el('summaryDone').onclick=()=>returnTarget==='backlog-list'?showBacklogList():showProjects();saveUi();
        } catch(error){fail(error,showProjects);}
    }

    return { open };
})();
