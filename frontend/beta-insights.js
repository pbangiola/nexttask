'use strict';
// Optional inspection/proposal: never replaces or optimizes the active Work queue.
window.BetaInsights = (() => {
    const encode = encodeURIComponent;
    const minutes = ms => (Number(ms || 0) / 60000).toFixed(2);
    const esc = text => String(text ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    let generation = 0;
    const zone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
    function flatten(tree,out=[]) {for(const row of tree){out.push(row);flatten(row.children||[],out);}return out;}
    function remaining(row) {if(row.node_type==='project'&&'remaining_estimate_ms' in row)return row.remaining_estimate_ms;const estimate=Number(row.estimated_ms);return Number.isFinite(estimate)&&estimate>0?Math.max(0,estimate-Number(row.elapsed_ms||0)):null;}
    function slack(row,now=Date.now()) {const duration=remaining(row);return row.due_at == null || duration == null ? null : row.due_at - duration - now;}
    function labelItems(items,tree) {
        const nodes=new Map(flatten(tree).map(row=>[row.id,row]));
        const labeled=items.map(row=>{
            const names=[row.name],seen=new Set([row.id]);let parent=nodes.get(row.parent_id);
            while(parent&&!seen.has(parent.id)){seen.add(parent.id);names.unshift(parent.name);parent=nodes.get(parent.parent_id);}
            return {...row,displayName:names.join(' / ')};
        });
        const counts=new Map();
        for(const row of labeled)counts.set(row.displayName,(counts.get(row.displayName)||0)+1);
        for(const row of labeled)if(counts.get(row.displayName)>1)row.displayName+=` [${row.id}]`;
        return labeled;
    }
    async function load() {
        if(window.taskSorterMode==='guest') {
            const {nodes}=await window.TaskGraph.request(`/users/${encode(userId)}/nodes?tree=1`);
            const metadata=JSON.parse(localStorage.getItem('nexttaskGuestPriorities_v1')||'{}');
            return {tree:nodes,items:labelItems(nodes.filter(row=>(row.node_type==='project'||row.independently_actionable===1)&&['pending','active','blocked'].includes(row.status)).map(row=>({...row,...metadata[row.id]})),nodes)};
        }
        const [tree,priorities]=await Promise.all([window.TaskGraph.request(`/users/${encode(userId)}/nodes?tree=1`),window.TaskGraph.request(`/users/${encode(userId)}/priorities`)]);
        return {tree:tree.nodes,items:labelItems(priorities.items,tree.nodes)};
    }
    async function rank(ids) {
        if(window.taskSorterMode==='guest') {
            const stored=JSON.parse(localStorage.getItem('nexttaskGuestPriorities_v1')||'{}');
            ids.forEach((id,i)=>{stored[id]={...stored[id],importance_rank:i+1};});localStorage.setItem('nexttaskGuestPriorities_v1',JSON.stringify(stored));
        } else await window.TaskGraph.request(`/users/${encode(userId)}/priorities/rank`,'PUT',{taskIds:ids});
    }
    async function setDue(id,dueAt) {
        if(window.taskSorterMode==='guest') {
            const stored=JSON.parse(localStorage.getItem('nexttaskGuestPriorities_v1')||'{}');stored[id]={...stored[id],due_at:dueAt};localStorage.setItem('nexttaskGuestPriorities_v1',JSON.stringify(stored));
        } else await window.TaskGraph.request(`/users/${encode(userId)}/priorities/${encode(id)}`,'PUT',{dueAt});
    }
    function shell(title) {hideStaticScreens();clearInterval(timerInterval);hide(el('stopWorkingBtn'));const container=clearDynamic();const h=document.createElement('h2');h.textContent=title;container.appendChild(h);return container;}
    function csv(rows) {
        const header=['Canonical ID','Parent ID','Node type','Name','Status','Estimated minutes','Acknowledged actual minutes','Variance minutes (actual minus estimate)'];
        const records=rows.map(row=>[row.id,row.parent_id||'',row.node_type,row.name,row.status,minutes(row.estimated_ms),minutes(row.elapsed_ms),minutes(Number(row.elapsed_ms||0)-Number(row.estimated_ms||0))]);
        const leaves=rows.filter(row=>row.node_type==='task');
        const total=field=>leaves.reduce((sum,row)=>sum+(field==='estimated_ms'&&row.status==='cancelled'?0:Number(row[field]||0)),0);
        const ownActual=rows.filter(row=>row.node_type==='project').reduce((sum,row)=>sum+Number(row.own_elapsed_ms||0),0);
        records.push(['','','summary-leaves','Leaf totals including retained history','',minutes(total('estimated_ms')),minutes(total('elapsed_ms')+ownActual),minutes(total('elapsed_ms')+ownActual-total('estimated_ms'))]);
        return [header,...records].map(row=>row.map(csvEscape).join(',')).join('\n');
    }
    function download(rows) {const link=document.createElement('a'),url=URL.createObjectURL(new Blob([csv(rows)],{type:'text/csv'}));link.href=url;link.download='nexttask-metrics-minutes.csv';link.click();URL.revokeObjectURL(url);}
    function hierarchy(nodes,parent) {
        for(const node of nodes) {
            const item=document.createElement(node.node_type==='project'?'details':'div');item.dataset.nodeId=node.id;
            const label=document.createElement(node.node_type==='project'?'summary':'span');label.textContent=`${node.name} — ${minutes(node.estimated_ms)} estimated / ${minutes(node.elapsed_ms)} actual / ${minutes(node.elapsed_ms-node.estimated_ms)} variance (min) [${node.status}]`;
            item.appendChild(label);
            if(node.node_type==='project' && window.taskSorterMode!=='guest') {
                const edit=document.createElement('button');edit.textContent='Edit / Move / Group / Ungroup';edit.onclick=()=>window.ProjectEditor.open(node.id,{origin:metrics,push:false});item.appendChild(edit);
            } else if(window.taskSorterMode!=='guest') {
                const edit=document.createElement('button');edit.textContent='Edit / Move task';edit.onclick=()=>window.ProjectEditor.editTask(node.id,{origin:metrics});
                const move=document.createElement('button');move.textContent='Move task';move.onclick=()=>window.ProjectEditor.moveTask(node.id,{origin:metrics});item.append(edit,move);
            }
            hierarchy(node.children||[],item);parent.appendChild(item);
        }
    }
    async function metrics() {
        const current=++generation,container=shell('Hierarchy and acknowledged metrics');container.append('Loading…');
        try {const {tree}=await load();if(current!==generation)return;container.lastChild.remove();
            const note=document.createElement('p');note.textContent='Units: minutes. Variance = actual − estimate. Project rows are bottom-up totals including retained own work from decomposition; the CSV summary counts each leaf and retained container-own actual once, with deleted estimates excluded and retained actual included. Intervals are not added to actual time.';container.appendChild(note);
            hierarchy(tree,container);
            const exportButton=document.createElement('button');exportButton.id='metricsExport';exportButton.textContent='Download metrics CSV';exportButton.onclick=()=>download(flatten(tree));
            const back=document.createElement('button');back.textContent='Back';back.onclick=showModeSelect;container.append(exportButton,back);
        } catch(error){container.append(document.createTextNode(error.message));}
    }
    function localDate(ms) {if(ms==null)return '';const date=new Date(ms);return new Date(ms-date.getTimezoneOffset()*60000).toISOString().slice(0,16);}
    async function matrix() {
        const current=++generation,container=shell('Optional importance / urgency view');container.append('Loading…');
        try {
            const {items}=await load();if(current!==generation)return;container.lastChild.remove();
            const ordered=[...items].sort((a,b)=>(a.importance_rank??Infinity)-(b.importance_rank??Infinity));
            const note=document.createElement('p');note.textContent=`Scope: open root tasks and parents, including blocked tasks. Compare parents with their peers; their children keep their own order and are not re-ranked. No inferred parent importance. Remaining = max(estimate − acknowledged actual, 0). Latest start = due − remaining; slack = latest start − now. Timezone: ${zone()}. Missing dates, estimates or ranks stay unspecified; zero estimate means unestimated. This view does not change Focus order.`;container.appendChild(note);
            const compare=document.createElement('button');compare.textContent='Rank importance pairwise';compare.id='rankImportance';compare.disabled=ordered.length<2;
            compare.onclick=async()=>{let cancel;const header=el('taskCompare').querySelector('h2');try{const comparison=shell('Choose the more important task');header.textContent='Which task is more important?';const run=++sortRunId;cancel=document.createElement('button');cancel.id='cancelImportance';cancel.textContent='Cancel importance ranking';cancel.onclick=()=>{++sortRunId;hide(el('taskCompare'));header.textContent='Which task comes first?';matrix();};comparison.appendChild(cancel);const ranked=await interactiveMergeSort(ordered.map(row=>({...row,name:row.displayName||row.name})),run);if(run!==sortRunId)return;hide(el('taskCompare'));header.textContent='Which task comes first?';await rank(ranked.map(row=>row.id));await matrix();}catch(error){hide(el('taskCompare'));header.textContent='Which task comes first?';alert(error.message);matrix();}finally{cancel?.remove();}};
            container.appendChild(compare);
            const grid=document.createElement('div');grid.id='importanceMatrix';grid.style.cssText='display:grid;grid-template-columns:1fr 1fr;gap:12px;border:1px solid #bbb;padding:12px';
            const labels=['Higher importance / latest-start overdue','Higher importance / time remains','Lower importance / latest-start overdue','Lower importance / time remains','Unspecified importance or urgency'];
            const groups=labels.map(label=>{const box=document.createElement('section');const h=document.createElement('h3');h.textContent=label;box.appendChild(h);grid.appendChild(box);return box;});
            const table=document.createElement('table');table.id='priorityTable';table.innerHTML='<thead><tr><th>Task / status</th><th>Importance</th><th>Due (local zone)</th><th>Latest start / slack</th><th>Explicit order</th></tr></thead>';
            ordered.forEach((row,index)=>{
                const available=slack(row),high=row.importance_rank != null && row.importance_rank<=Math.ceil(ordered.length/2);
                const p=document.createElement('p');p.textContent=row.displayName||row.name;groups[row.importance_rank==null||available==null?4:high?(available<=0?0:1):(available<=0?2:3)].appendChild(p);
                const tr=document.createElement('tr');tr.dataset.taskId=row.id;tr.innerHTML=`<td>${esc(row.displayName||row.name)} [${esc(row.status)}]</td><td>${row.importance_rank??'Unspecified'}</td><td></td><td>${available==null?(row.due_at==null?'Unspecified deadline':'Unspecified estimate'):esc(new Date(row.due_at-remaining(row)).toLocaleString())+'; '+minutes(available)+' min '+(available<=0?'latest-start overdue':'slack')}</td><td></td>`;
                const input=document.createElement('input');input.type='datetime-local';input.value=localDate(row.due_at);input.setAttribute('aria-label',`Due for ${row.name}`);
                const save=document.createElement('button');save.textContent='Save due';save.onclick=async()=>{const due=input.value?new Date(input.value).getTime():null;if(due!==null&&!Number.isFinite(due))return alert('Invalid date.');save.disabled=true;try{await setDue(row.id,due);await matrix();}catch(error){save.disabled=false;alert(error.message);}};tr.children[2].append(input,save);
                for(const delta of [-1,1]) {const button=document.createElement('button');button.textContent=delta<0?'Up':'Down';button.disabled=index+delta<0||index+delta>=ordered.length;button.onclick=async()=>{const copy=[...ordered];[copy[index],copy[index+delta]]=[copy[index+delta],copy[index]];button.disabled=true;try{await rank(copy.map(node=>node.id));await matrix();}catch(error){alert(error.message);matrix();}};tr.children[4].appendChild(button);}
                table.appendChild(tr);
            });
            const key=document.createElement('p');key.textContent='Illustrative quadrants: higher importance is the top half of the explicit order; urgency is latest-start slack ≤ 0. This threshold is a view proposal, not an optimized scheduling policy.';
            const refresh=document.createElement('button');refresh.textContent='Refresh urgency';refresh.onclick=matrix;
            const back=document.createElement('button');back.textContent='Back';back.onclick=showModeSelect;container.append(key,grid,table,refresh,back);
        } catch(error){container.append(document.createTextNode(error.message));}
    }
    for(const [id,label,handler] of [['insightsBtn','Importance / urgency (optional)',matrix],['metricsBtn','Hierarchy / metrics',metrics]]) {
        const button=document.createElement('button');button.id=id;button.textContent=label;button.onclick=handler;el('modeSelect').appendChild(button);
    }
    return {matrix,metrics,slack,remaining,csv};
})();
