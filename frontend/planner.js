'use strict';

// Project Planner is deliberately isolated from the Work execution engine.
// It shares the Task Sorter shell and can read the current unfinished backlog,
// while keeping project hierarchy in its own persisted state until the backend
// task-node schema is extended to store parent relationships.
window.ProjectPlanner = (() => {
    const STATE_KEY = 'nextTaskProjectPlanner';
    const PROJECT_THRESHOLD_MINUTES = 20;

    let projects = [];
    let project = null;
    let view = 'planner-home';
    let scopePath = [];
    let activePlannerTaskId = null;
    let pendingHasParts = false;
    let backlog = [];
    let seedBacklogId = null;
    let pendingBacklogIds = [];
    let returnToBacklog = false;
    let returnToProjects = false;
    let combineSeedId = null;

    const makeId = prefix => `${prefix}_${globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2, 11)}`;
    const escape = value => String(value ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');

    function makeNode(name, values = {}) {
        return {
            id: values.id || makeId('plan'),
            name: String(name || '').trim(),
            estimatedMinutes: values.estimatedMinutes ?? null,
            children: Array.isArray(values.children) ? values.children.map(cloneNode) : [],
            decompositionReviewed: Boolean(values.decompositionReviewed)
        };
    }
    function cloneNode(node) { return makeNode(node.name, node); }
    function cloneProject(source) {
        return source ? {
            id: source.id,
            name: source.name,
            initialEstimateMinutes: source.initialEstimateMinutes,
            tasks: (source.tasks || []).map(cloneNode)
        } : null;
    }
    function upsertProject() {
        if (!project?.id || !project.name) return;
        const copy = cloneProject(project);
        const index = projects.findIndex(item => item.id === copy.id);
        if (index >= 0) projects[index] = copy;
        else projects.push(copy);
    }

    function snapshot() {
        return { projects, project, view, scopePath, activePlannerTaskId, pendingHasParts, backlog, seedBacklogId, pendingBacklogIds, returnToBacklog, returnToProjects, combineSeedId };
    }
    function savePlanner() { localStorage.setItem(STATE_KEY, JSON.stringify(snapshot())); }
    function loadPlanner() {
        const raw = localStorage.getItem(STATE_KEY);
        if (!raw) return;
        try {
            const state = JSON.parse(raw);
            projects = Array.isArray(state.projects) ? state.projects : [];
            project = state.project || null;
            view = state.view || 'planner-home';
            scopePath = Array.isArray(state.scopePath) ? state.scopePath : [];
            activePlannerTaskId = state.activePlannerTaskId || null;
            pendingHasParts = Boolean(state.pendingHasParts);
            backlog = Array.isArray(state.backlog) ? state.backlog : [];
            seedBacklogId = state.seedBacklogId || null;
            pendingBacklogIds = Array.isArray(state.pendingBacklogIds) ? state.pendingBacklogIds : [];
            returnToBacklog = Boolean(state.returnToBacklog);
            returnToProjects = Boolean(state.returnToProjects);
            combineSeedId = state.combineSeedId || null;
        } catch (error) {
            console.warn('Project Planner state could not be restored:', error);
        }
    }

    function plannerActive() { return localStorage.getItem(`${STATE_KEY}:active`) === 'true'; }
    function setPlannerActive(active) { localStorage.setItem(`${STATE_KEY}:active`, active ? 'true' : 'false'); }

    function clearShell() {
        hideStaticScreens();
        hide(el('stopWorkingBtn'));
        hide(el('startOverBtn'));
        hide(el('taskCompare'));
        return clearDynamic();
    }
    function exitPlanner() {
        setPlannerActive(false);
        hide(el('taskCompare'));
        clearDynamic();
        showModeSelect();
    }

    function open() {
        setPlannerActive(true);
        loadPlanner();
        restorePlannerView();
    }

    function restorePlannerView() {
        if (view === 'review-entry') return showReviewEntry();
        if (view === 'backlog-list') return showBacklogList();
        if (view === 'backlog-membership') return showMembership(seedBacklogId);
        if (view === 'backlog-related') return showRelated(seedBacklogId);
        if (view === 'projects-list') return showProjects();
        if (view === 'combine-projects') return showCombineProjects();
        if (view === 'define-project') return showDefineProject();
        if (view === 'parts-entry') return showPartsEntry(scopePath);
        if (view === 'estimate-task') return showEstimate(scopePath, activePlannerTaskId);
        if (view === 'reorder-task') return showReorder(scopePath, activePlannerTaskId, pendingHasParts);
        if (view === 'subproject-callout') return showSubprojectCallout(scopePath, activePlannerTaskId);
        if (view === 'summary' && project) return showSummary();
        showPlannerHome();
    }

    function showPlannerHome() {
        view = 'planner-home';
        const container = clearShell();
        container.innerHTML = `
            <h2>Project Planner</h2>
            <p>What would you like to do?</p>
            <div class="planner-choice-grid">
                <button id="plannerCreate">Create a Project<span>I know what I want to accomplish.</span></button>
                <button id="plannerReview">Review Your Existing Backlog<span>Find work that belongs together.</span></button>
            </div>
            <button id="plannerExit" class="planner-secondary">Back to Task Sorter</button>`;
        el('plannerCreate').onclick = () => { project = null; returnToBacklog = false; returnToProjects = false; showDefineProject(); };
        el('plannerReview').onclick = showReviewEntry;
        el('plannerExit').onclick = exitPlanner;
        savePlanner();
    }

    // B0
    function showReviewEntry() {
        view = 'review-entry';
        refreshBacklogFromTaskSorter();
        const container = clearShell();
        container.innerHTML = `
            <h2>Project Planner</h2><p>What would you like to review?</p>
            <div class="planner-choice-grid">
                <button id="reviewBacklog">Uncategorized Backlog<span>Look for tasks that belong to projects.</span></button>
                <button id="reviewProjects">Existing Projects<span>View or edit projects you already created.</span></button>
            </div>
            <button id="reviewBack" class="planner-secondary">Back</button>`;
        el('reviewBacklog').onclick = showBacklogList;
        el('reviewProjects').onclick = showProjects;
        el('reviewBack').onclick = showPlannerHome;
        savePlanner();
    }

    function refreshBacklogFromTaskSorter() {
        if (!Array.isArray(globalThis.sortedTasks)) return;
        const existing = new Map(backlog.map(item => [item.sourceTaskId || item.id, item]));
        const current = globalThis.sortedTasks.filter(task => !task.completed && String(task.name).toLowerCase() !== 'sort tasks');
        backlog = current.map(task => existing.get(task.id) || { id: makeId('backlog'), sourceTaskId: task.id, name: task.name, projectId: null, reviewed: false });
    }
    function uncategorized() { return backlog.filter(item => !item.projectId); }

    // B1
    function showBacklogList() {
        view = 'backlog-list';
        refreshBacklogFromTaskSorter();
        const items = uncategorized();
        const container = clearShell();
        container.innerHTML = `<h2>Uncategorized Backlog</h2><p>Choose a task to review.</p><div id="backlogLinks" class="planner-list"></div><button id="backlogBack" class="planner-secondary">Back</button>`;
        const list = el('backlogLinks');
        if (!items.length) list.innerHTML = '<p class="muted">There are no uncategorized tasks in the current backlog.</p>';
        items.forEach(item => {
            const button = document.createElement('button');
            button.textContent = item.name;
            button.onclick = () => showMembership(item.id);
            list.appendChild(button);
        });
        el('backlogBack').onclick = showReviewEntry;
        savePlanner();
    }

    // B2
    function showMembership(id) {
        const item = backlog.find(entry => entry.id === id && !entry.projectId);
        if (!item) return showBacklogList();
        seedBacklogId = id;
        view = 'backlog-membership';
        const container = clearShell();
        container.innerHTML = `<h2>${escape(item.name)}</h2><p><strong>Is this part of a project?</strong></p><div class="planner-choice-grid"><button id="memberYes">Yes</button><button id="memberNo">No</button></div><button id="memberBack" class="planner-secondary">Back</button>`;
        el('memberYes').onclick = () => showRelated(id);
        el('memberNo').onclick = () => { item.reviewed = true; savePlanner(); showBacklogList(); };
        el('memberBack').onclick = showBacklogList;
        savePlanner();
    }

    // B3 -> A1/A2
    function showRelated(id) {
        const seed = backlog.find(entry => entry.id === id && !entry.projectId);
        if (!seed) return showBacklogList();
        seedBacklogId = id;
        view = 'backlog-related';
        const container = clearShell();
        container.innerHTML = `<h2>${escape(seed.name)}</h2><p><strong>What other work belongs with this?</strong></p><div id="relatedChecklist"></div><button id="relatedContinue" class="btn-action">Create a Project</button><button id="relatedBack" class="planner-secondary">Back</button>`;
        const checklist = el('relatedChecklist');
        uncategorized().filter(item => item.id !== id).forEach(item => {
            const label = document.createElement('label');
            label.className = 'planner-check';
            label.innerHTML = `<input type="checkbox" value="${item.id}"><span>${escape(item.name)}</span>`;
            checklist.appendChild(label);
        });
        el('relatedContinue').onclick = () => {
            const selected = Array.from(checklist.querySelectorAll('input:checked')).map(input => input.value);
            pendingBacklogIds = [id, ...selected];
            const selectedItems = pendingBacklogIds.map(itemId => backlog.find(entry => entry.id === itemId)).filter(Boolean);
            project = { id: makeId('project'), name: '', initialEstimateMinutes: null, tasks: selectedItems.map(item => makeNode(item.name)) };
            returnToBacklog = true;
            returnToProjects = false;
            savePlanner();
            showDefineProject();
        };
        el('relatedBack').onclick = () => showMembership(id);
        savePlanner();
    }

    // C1
    function leafCount(nodes) {
        return (nodes || []).reduce((sum, node) => sum + (node.children?.length ? leafCount(node.children) : 1), 0);
    }
    function nodeMinutes(node) {
        return node.children?.length ? node.children.reduce((sum, child) => sum + nodeMinutes(child), 0) : Number(node.estimatedMinutes || 0);
    }
    function projectMinutes(item) { return (item.tasks || []).reduce((sum, node) => sum + nodeMinutes(node), 0); }
    function showProjects() {
        upsertProject();
        project = null;
        view = 'projects-list';
        const container = clearShell();
        container.innerHTML = `<h2>Existing Projects</h2><div id="projectList" class="planner-project-list"></div><div class="planner-choice-grid"><button id="addProject">Add New Project</button><button id="combineProjects">Combine Projects</button></div><button id="projectsBack" class="planner-secondary">Back</button>`;
        const list = el('projectList');
        if (!projects.length) list.innerHTML = '<p class="muted">No projects yet.</p>';
        projects.forEach(item => {
            const row = document.createElement('div'); row.className = 'planner-project-row';
            const link = document.createElement('button'); link.className = 'planner-project-link'; link.textContent = item.name;
            link.onclick = () => { project = cloneProject(item); showSummary(); };
            const meta = document.createElement('span'); meta.textContent = `${projectMinutes(item)} min • ${leafCount(item.tasks)} steps • Click to view or edit`;
            row.append(link, meta); list.appendChild(row);
        });
        el('addProject').onclick = () => { project = null; returnToProjects = true; returnToBacklog = false; showDefineProject(); };
        el('combineProjects').onclick = showCombineProjects;
        el('projectsBack').onclick = showReviewEntry;
        savePlanner();
    }

    function showCombineProjects() {
        view = 'combine-projects';
        const container = clearShell();
        container.innerHTML = `<h2>Combine Projects</h2><p>Choose the first project that belongs in a larger project.</p><div id="combineList" class="planner-list"></div><button id="combineBack" class="planner-secondary">Back</button>`;
        const list = el('combineList');
        projects.forEach(item => { const button=document.createElement('button'); button.textContent=item.name; button.onclick=()=>showCombineRelated(item.id); list.appendChild(button); });
        el('combineBack').onclick = showProjects;
        savePlanner();
    }
    function showCombineRelated(seedId) {
        const seed = projects.find(item => item.id === seedId); if (!seed) return showProjects();
        combineSeedId = seedId;
        const container = clearShell();
        container.innerHTML = `<h2>${escape(seed.name)}</h2><p>What other projects belong with this?</p><div id="combineChecks"></div><button id="combineContinue" class="btn-action">Create Parent Project</button><button id="combineRelatedBack" class="planner-secondary">Back</button>`;
        const checks=el('combineChecks');
        projects.filter(item=>item.id!==seedId).forEach(item=>{const label=document.createElement('label');label.className='planner-check';label.innerHTML=`<input type="checkbox" value="${item.id}"><span>${escape(item.name)}</span>`;checks.appendChild(label);});
        el('combineContinue').onclick=()=>{
            const ids=[seedId,...Array.from(checks.querySelectorAll('input:checked')).map(input=>input.value)];
            const chosen=ids.map(id=>projects.find(item=>item.id===id)).filter(Boolean);
            if(chosen.length<2){alert('Choose at least one other project.');return;}
            project={id:makeId('project'),name:'',initialEstimateMinutes:null,tasks:chosen.map(item=>makeNode(item.name,{estimatedMinutes:projectMinutes(item),children:item.tasks}))};
            returnToProjects=true; returnToBacklog=false; showDefineProject();
        };
        el('combineRelatedBack').onclick=showCombineProjects;
        savePlanner();
    }

    // A1
    function showDefineProject() {
        view = 'define-project';
        const discovered = returnToBacklog && pendingBacklogIds.length;
        const container = clearShell();
        container.innerHTML = `<h2>${discovered ? 'These tasks belong together.' : 'Create a Project'}</h2><label> ${discovered ? 'What should we call this project?' : 'What are you working on?'}<input id="projectName" type="text"></label><label>About how long do you think the whole project will take?<input id="projectEstimate" type="number" min="1" placeholder="Minutes"></label><button id="projectContinue" class="btn-action">Continue</button><button id="projectBack" class="planner-secondary">Back</button>`;
        if(project){el('projectName').value=project.name||'';el('projectEstimate').value=project.initialEstimateMinutes||'';}
        el('projectContinue').onclick=()=>{
            const name=el('projectName').value.trim();const estimate=Number.parseInt(el('projectEstimate').value,10);
            if(!name||!Number.isFinite(estimate)||estimate<1){alert('Enter a project name and your best estimate in minutes.');return;}
            project={id:project?.id||makeId('project'),name,initialEstimateMinutes:estimate,tasks:project?.tasks||[]};savePlanner();showPartsEntry([]);
        };
        el('projectBack').onclick=()=> returnToBacklog ? showRelated(seedBacklogId) : (returnToProjects ? showProjects() : showPlannerHome());
        savePlanner();
    }

    function getNode(path) {
        let nodes=project?.tasks||[];let current=null;
        for(const id of path){current=nodes.find(node=>node.id===id);if(!current)return null;nodes=current.children||[];}
        return current;
    }
    function scopeNodes(path){return path.length?(getNode(path)?.children||[]):(project?.tasks||[]);}
    function setScope(path,nodes){if(!path.length)project.tasks=nodes;else{const owner=getNode(path);if(owner)owner.children=nodes;}}
    function scopeTitle(path){return path.length?(getNode(path)?.name||project.name):project.name;}
    function parseNames(text){return String(text||'').split(/\r?\n/).map(line=>line.replace(/^\s*\d+[.)]\s*/,'').trim()).filter(Boolean);}

    // A2 + A3
    function showPartsEntry(path) {
        scopePath=[...path]; activePlannerTaskId=null; view='parts-entry';
        const existing=scopeNodes(path);const container=clearShell();
        container.innerHTML=`<h2>${escape(scopeTitle(path))}</h2><p><strong>What are all the parts of this project you can think of?</strong></p><textarea id="partsText" rows="9"></textarea><label class="planner-check"><input id="skipPlannerSort" type="checkbox"><span>Keep this order (skip sorting)</span></label><button id="partsContinue" class="btn-action">Continue</button><div class="upload-container"><p>Or upload a task list:</p><input id="plannerUpload" type="file" accept=".txt,.csv,text/plain,text/csv"></div>`;
        el('partsText').value=existing.map(node=>node.name).join('\n');
        el('plannerUpload').onchange=event=>{const file=event.target.files?.[0];if(!file)return;const reader=new FileReader();reader.onload=e=>{const text=String(e.target.result||'');const rows=parseCsv(text);const names=rows.map((row,index)=>{const first=String(row[0]||'').trim();return index===0&&/task|name/i.test(first)?'':first;}).filter(Boolean);el('partsText').value=names.join('\n');};reader.readAsText(file);};
        el('partsContinue').onclick=async()=>{const names=parseNames(el('partsText').value);if(!names.length){alert('Enter at least one part.');return;}const byName=new Map(existing.map(node=>[node.name,node]));let nodes=names.map(name=>byName.get(name)||makeNode(name));if(!el('skipPlannerSort').checked&&nodes.length>1)nodes=await plannerSort(nodes,scopeTitle(path));setScope(path,nodes);savePlanner();continuePlanning(path);};
        savePlanner();
    }
    async function plannerSort(nodes,title){return plannerMergeSort([...nodes],title);}
    async function plannerMergeSort(nodes,title){if(nodes.length<=1)return nodes;const middle=Math.floor(nodes.length/2);const left=await plannerMergeSort(nodes.slice(0,middle),title);const right=await plannerMergeSort(nodes.slice(middle),title);return plannerMerge(left,right,title);}
    function plannerMerge(left,right,title){return new Promise(resolve=>{const merged=[];show(el('taskCompare'));clearDynamic();const heading=el('taskCompare').querySelector('h2');heading.textContent=`${title}: Which comes first?`;function next(){if(!left.length||!right.length){hide(el('taskCompare'));resolve([...merged,...left,...right]);return;}el('task1').textContent=left[0].name;el('task2').textContent=right[0].name;el('task1').onclick=()=>{merged.push(left.shift());next();};el('task2').onclick=()=>{merged.push(right.shift());next();};}next();});}

    // A4
    function continuePlanning(path){const nodes=scopeNodes(path);const next=nodes.find(node=>node.estimatedMinutes===null);if(next)return showEstimate(path,next.id);if(path.length)return continuePlanning(path.slice(0,-1));showSummary();}
    function showEstimate(path,id){const node=scopeNodes(path).find(item=>item.id===id);if(!node)return continuePlanning(path);scopePath=[...path];activePlannerTaskId=id;view='estimate-task';const nodes=scopeNodes(path);const index=nodes.findIndex(item=>item.id===id);const container=clearShell();container.innerHTML=`<h2>${escape(scopeTitle(path))}</h2><p>Task ${index+1} of ${nodes.length}</p><h3>${escape(node.name)}</h3><label>How long do you think this will take?<input id="nodeEstimate" type="number" min="1" value="${node.estimatedMinutes||''}"></label><label class="planner-check"><input id="nodeOutOfOrder" type="checkbox"><span>This task is out of order</span></label><label class="planner-check"><input id="nodeHasParts" type="checkbox"><span>This task has parts</span></label><button id="estimateContinue" class="btn-action">Continue</button>`;el('estimateContinue').onclick=()=>{const minutes=Number.parseInt(el('nodeEstimate').value,10);if(!Number.isFinite(minutes)||minutes<1){alert('Enter your best estimate in minutes.');return;}node.estimatedMinutes=minutes;const out=el('nodeOutOfOrder').checked;const parts=el('nodeHasParts').checked;pendingHasParts=parts;savePlanner();if(out)showReorder(path,id,parts);else handleParts(path,id,parts);};savePlanner();}
    function showReorder(path,id,hasParts){const node=scopeNodes(path).find(item=>item.id===id);if(!node)return continuePlanning(path);view='reorder-task';scopePath=[...path];activePlannerTaskId=id;pendingHasParts=hasParts;const rest=scopeNodes(path).filter(item=>item.id!==id);const container=clearShell();container.innerHTML=`<h2>Where should this task go?</h2><div id="reorderSlots"></div><div class="planner-moving">Moving: <strong>${escape(node.name)}</strong></div>`;const slots=el('reorderSlots');for(let i=0;i<=rest.length;i++){const button=document.createElement('button');button.className='planner-insert';button.textContent=i===0?'Move to top':i===rest.length?'Move to end':'Move here';button.onclick=()=>{const reordered=[...rest];reordered.splice(i,0,node);setScope(path,reordered);savePlanner();handleParts(path,id,hasParts);};slots.appendChild(button);if(i<rest.length){const row=document.createElement('div');row.className='planner-order-row';row.textContent=`${i+1}. ${rest[i].name}`;slots.appendChild(row);}}savePlanner();}
    function handleParts(path,id,hasParts){const node=scopeNodes(path).find(item=>item.id===id);if(!node)return continuePlanning(path);if(hasParts)return startSubproject(path,id);if(node.estimatedMinutes>PROJECT_THRESHOLD_MINUTES&&!node.decompositionReviewed)return showSubprojectCallout(path,id);continuePlanning(path);}
    function showSubprojectCallout(path,id){const node=scopeNodes(path).find(item=>item.id===id);if(!node)return continuePlanning(path);view='subproject-callout';scopePath=[...path];activePlannerTaskId=id;const container=clearShell();container.innerHTML=`<h2>${escape(scopeTitle(path))}</h2><div class="planner-callout"><h3>This may be a project</h3><p><strong>${escape(node.name)}</strong> is estimated at ${node.estimatedMinutes} minutes.</p><div class="planner-choice-grid"><button id="breakParts">Break Into Parts</button><button id="keepTask">Keep As One Task</button></div></div>`;el('breakParts').onclick=()=>startSubproject(path,id);el('keepTask').onclick=()=>{node.decompositionReviewed=true;savePlanner();continuePlanning(path);};savePlanner();}
    function startSubproject(path,id){const node=scopeNodes(path).find(item=>item.id===id);if(!node)return continuePlanning(path);node.decompositionReviewed=true;node.children||=[];savePlanner();showPartsEntry([...path,id]);}

    function renderTree(nodes){const ul=document.createElement('ul');nodes.forEach(node=>{const li=document.createElement('li');li.innerHTML=`<strong>${escape(node.name)}</strong> — ${nodeMinutes(node)} min`;if(node.children?.length)li.appendChild(renderTree(node.children));ul.appendChild(li);});return ul;}
    function finalizeBacklogAssignments(){if(!returnToBacklog||!project?.id)return;pendingBacklogIds.forEach(id=>{const item=backlog.find(entry=>entry.id===id);if(item)item.projectId=project.id;});pendingBacklogIds=[];returnToBacklog=false;}
    function showSummary(){upsertProject();finalizeBacklogAssignments();view='summary';const container=clearShell();container.innerHTML=`<h2>${escape(project.name)}</h2><p>Initial estimate: <strong>${project.initialEstimateMinutes} min</strong></p><p>Planned estimate: <strong>${projectMinutes(project)} min</strong></p><h3>Project Plan</h3><div id="summaryTree"></div><div class="planner-choice-grid"><button id="editProject">Edit Project</button><button id="finishProject">${returnToProjects?'Return to Projects':'Project Planned'}</button></div>`;el('summaryTree').appendChild(renderTree(project.tasks));el('editProject').onclick=()=>showPartsEntry([]);el('finishProject').onclick=()=>{upsertProject();project=null;if(returnToProjects){returnToProjects=false;showProjects();}else showPlannerHome();};savePlanner();}

    document.addEventListener('DOMContentLoaded', () => { loadPlanner(); if (plannerActive()) restorePlannerView(); });
    return { open, exit: exitPlanner, showHome: showPlannerHome };
})();
