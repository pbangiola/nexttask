'use strict';
window.NextPlan=(()=>{
    const request=(path='',method='GET',body)=>window.TaskGraph.request('/plan'+path,method,body);
    const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const minute=value=>value==null?'?':Math.round(value/60000);
    const local=value=>value==null?'':new Date(value-new Date(value).getTimezoneOffset()*60000).toISOString().slice(0,16);
    const date=value=>value==null?'':new Date(value).toLocaleString([], {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
    let state=null,view='inbox',project=null,search='',filter='all',sort='sequence',selected=new Set(),generation=0;
    let panel;
    const openNode=n=>n.status!=='cancelled'&&!n.archived&&n.status!=='completed';
    const btn=(label,fn,primary=false)=>{const b=document.createElement('button');b.type='button';b.textContent=label;b.onclick=()=>Promise.resolve().then(fn).catch(error=>message(error.message));if(primary)b.className='primary';return b;};
    function message(value){const target=document.getElementById('planMessage');if(target)target.textContent=value;else alert(value);}
    const node=id=>state.nodes.find(n=>n.id===id);
    const item=id=>state.forecast.items.find(n=>n.id===id);
    async function load(){state=await request();execution.adopt(state);return state;}
    async function change(path,method,body){
        const requestId=createId('plan_request'),payload={...body,version:state.version,requestId};
        try{await request(path,method,payload);await load();selected.clear();render();}
        catch(error){
            if(error.status===409){await load();render();throw new Error('The plan changed elsewhere. Your change was not applied. Review the refreshed plan and try again.');}
            else if(error.status)throw error;
            else {let retries=0;while(retries++<2){try{await request(path,method,payload);await load();selected.clear();render();return;}catch(next){if(next.status)throw next;}}throw new Error('Connection lost. Your change may have saved. Refresh before making another change.');}
        }
    }
    function shell(){
        document.body.classList.add('planning');hideStaticScreens();hide(el('stopWorkingBtn'));hide(el('startOverBtn'));
        const host=clearDynamic();panel=document.createElement('div');panel.className='plan-app';panel.id='nextPlan';host.append(panel);
        return panel;
    }
    async function open(next=view,id=project){
        if(window.taskSorterMode==='guest'){alert('Sign in to manage your saved Plan.');return;}
        if(el('focusScreen')&&currentTask()){const paused=window.FocusDurability.pause(currentTask());if(!paused)return;await paused;}
        const current=++generation;view=next;project=id;shell().textContent='Loading your plan…';
        try{await window.TaskGraph.flush();await load();if(current===generation)render();}catch(error){panel.replaceChildren(btn('Retry loading Plan',()=>open(next,id)));const p=document.createElement('p');p.textContent=error.message;panel.append(p);}
    }
    function path(n){const names=[];let parent=node(n.parent_id);while(parent){names.unshift(parent.name);parent=node(parent.parent_id);}return names.join(' / ');}
    function list(){
        const day=new Date();day.setHours(23,59,59,999);const now=Date.now(),end=day.getTime();
        let rows=state.nodes.filter(n=>{
            if(view==='completed')return n.status==='completed'&&!n.archived;
            if(view==='archive')return n.archived||n.status==='cancelled';
            if(!openNode(n)||window.PlanDomain.graph(state.nodes,state.dependencies).ancestors(n.id).some(a=>a.archived||a.status==='cancelled'))return false;
            if(view==='inbox')return !n.parent_id&&n.node_type==='task';
            if(view==='projects')return n.node_type==='project'&&!n.parent_id;
            if(view==='project')return n.parent_id===project;
            if(view==='today')return n.node_type==='task'&&[n.due_at,n.deadline_at,item(n.id)?.dueAt,item(n.id)?.deadlineAt,n.scheduled_start_at,item(n.id)?.start].some(at=>at!=null&&at<=end);
            if(view==='upcoming')return n.node_type==='task'&&[n.due_at,n.deadline_at,item(n.id)?.dueAt,item(n.id)?.deadlineAt,n.scheduled_start_at,item(n.id)?.start].some(at=>at!=null&&at>now);
            return true;
        });
        if(search)rows=rows.filter(n=>[n.name,n.description,n.notes,path(n),...(n.tags||[])].join(' ').toLowerCase().includes(search.toLowerCase()));
        if(filter!=='all')rows=rows.filter(n=>filter==='ready'?item(n.id)?.ready:filter==='blocked'?(item(n.id)?.blockedBy.length||0)>0:filter==='overdue'?[n.due_at,n.deadline_at,item(n.id)?.dueAt,item(n.id)?.deadlineAt].some(at=>at!=null&&at<now):n.node_type==='project');
        const order=state.forecast.schedule.map(i=>i.id),rank=state.forecast.importanceOrder;
        rows.sort((a,b)=>sort==='name'?a.name.localeCompare(b.name):sort==='due'?(a.deadline_at??a.due_at??Infinity)-(b.deadline_at??b.due_at??Infinity):sort==='importance'?rank.indexOf(a.id)-rank.indexOf(b.id):(order.includes(a.id)?order.indexOf(a.id):100000+a.position)-(order.includes(b.id)?order.indexOf(b.id):100000+b.position));
        return rows;
    }
    function row(n,compact=false){
        const forecast=item(n.id),element=document.createElement('article');element.className='plan-row';element.dataset.taskId=n.id;
        if(!compact){const check=document.createElement('input');check.type='checkbox';check.checked=selected.has(n.id);check.setAttribute('aria-label','Select '+n.name);check.onchange=()=>{check.checked?selected.add(n.id):selected.delete(n.id);renderBulk();};element.append(check);}
        const content=document.createElement('div'),title=btn(n.name,()=>n.node_type==='project'&&openNode(n)?open('project',n.id):edit(n.id));title.className='title';content.append(title);
        const meta=document.createElement('div');meta.className='meta';
        const bits=[n.node_type==='project'?`${n.progress.completed}/${n.progress.total} components complete`:n.status,`${minute(n.progress.remainingMs)} min remaining`,`${minute(n.progress.actualMs)} min worked`];
        if(path(n))bits.unshift(path(n));if(n.due_at)bits.push('Due '+date(n.due_at));if(n.deadline_at)bits.push('Deadline '+date(n.deadline_at));if(n.recurrence_days)bits.push(`Every ${n.recurrence_days} days`);bits.push(...n.tags.map(t=>'#'+t));meta.textContent=bits.join(' · ');content.append(meta);
        if(n.node_type==='project'&&n.progress.total){const progress=document.createElement('progress');progress.max=n.progress.total;progress.value=n.progress.completed;progress.setAttribute('aria-label','Completed components');content.append(progress);}
        if(forecast){const reason=document.createElement('div');reason.className='reason';reason.textContent=(forecast.start!=null?date(forecast.start)+' · ':'')+(forecast.blockedBy.length?'Waiting for '+forecast.blockedBy.join(', '):forecast.reason);content.append(reason);}
        element.append(content);
        if(!compact){const actions=document.createElement('div');actions.className='plan-actions';actions.append(btn('Edit',()=>edit(n.id)));
            if(!n.archived&&n.status!=='cancelled'&&n.node_type==='task')actions.append(btn(n.status==='completed'?'Reopen':'Complete',()=>change('/tasks/'+encodeURIComponent(n.id),'PUT',{status:n.status==='completed'?'pending':'completed'})));
            if(n.archived||n.status==='cancelled')actions.append(btn('Restore',()=>change('/tasks/'+encodeURIComponent(n.id)+(n.status==='cancelled'?'/restore':''),n.status==='cancelled'?'POST':'PUT',n.status==='cancelled'?{}:{archived:false})));
            element.append(actions);
        }
        return element;
    }
    function renderBulk(){
        const target=document.getElementById('planBulk');if(!target)return;target.replaceChildren();
        const visible=list(),selectLabel=document.createElement('label'),selectAll=document.createElement('input');
        selectAll.type='checkbox';selectAll.setAttribute('aria-label','Select all visible items');
        selectAll.checked=visible.length>0&&visible.every(n=>selected.has(n.id));
        selectAll.indeterminate=!selectAll.checked&&visible.some(n=>selected.has(n.id));
        selectAll.disabled=!visible.length;
        selectAll.onchange=()=>{for(const n of visible)selectAll.checked?selected.add(n.id):selected.delete(n.id);renderContent();};
        selectLabel.className='plan-select-all';selectLabel.append(selectAll,document.createTextNode('Select all visible'));target.append(selectLabel);
        if(!selected.size)return;
        target.append(document.createTextNode(selected.size+' selected '));
        const ids=[...selected];
        target.append(btn('Edit selected',()=>bulkEdit(ids)),btn('Complete',()=>change('/bulk','POST',{ids,changes:{status:'completed'}})),btn('Reopen',()=>change('/bulk','POST',{ids,changes:{status:'pending'}})),btn('Archive',()=>change('/bulk','POST',{ids,changes:{archived:true}})),btn('Move',()=>move(ids)),btn('Delete selected',()=>bulkDelete(ids)),btn('Clear',()=>{selected.clear();render();}));
    }
    function render(){
        shell();
        const heading=document.createElement('header');heading.className='plan-head';
        const title=document.createElement('div');title.innerHTML='<span class="muted">NEXTTASK · PLAN</span><h2>'+esc(view==='project'?node(project)?.name||'Project':({inbox:'Inbox',all:'Your landscape',projects:'Projects',today:'Today',upcoming:'Upcoming',calendar:'Calendar',matrix:'Importance & urgency',completed:'Completed work',archive:'Archived work'})[view])+'</h2>';
        const actions=document.createElement('div');actions.className='plan-actions';actions.append(btn('Work',()=>work()),btn('Availability',availability),btn('Refresh',()=>open()),btn('Home',()=>{document.body.classList.remove('planning');showModeSelect();}));heading.append(title,actions);panel.append(heading);
        const nav=document.createElement('nav');nav.className='plan-nav';nav.setAttribute('aria-label','Plan views');
        for(const [key,label]of Object.entries({inbox:'Inbox',all:'All work',projects:'Projects',today:'Today',upcoming:'Upcoming',calendar:'Calendar',matrix:'Matrix',completed:'Completed',archive:'Archive'})){const b=btn(label,()=>{selected.clear();return open(key,null);});if(view===key)b.setAttribute('aria-current','page');nav.append(b);}panel.append(nav);
        const status=document.createElement('p');status.id='planMessage';status.className='plan-error';status.setAttribute('role','status');panel.append(status);
        if(view==='project'){
            const n=node(project),summary=document.createElement('div');summary.className='plan-stats';summary.textContent=`${n.progress.completed}/${n.progress.total} components completed · ${minute(n.progress.remainingMs)} min remaining · ${minute(n.progress.actualMs)} min recorded`;
            panel.append(summary,btn('Edit project',()=>edit(project)),btn('Parent',()=>n.parent_id?open('project',n.parent_id):open('projects',null)));
        }
        const capture=document.createElement('form');capture.className='plan-capture';
        const input=document.createElement('input');input.placeholder='Capture a task, optionally with “, 15m”';input.setAttribute('aria-label','Quick add task');input.required=true;
        const add=btn('Add task',()=>{} ,true);add.type='submit';capture.onsubmit=async e=>{e.preventDefault();const parsed=window.TaskEntry.parse(input.value);if(parsed.invalid.length||!parsed.entries.length)return message('Enter a task, optionally followed by a duration.');add.disabled=true;try{await change('/tasks','POST',{tasks:parsed.entries.map(n=>({...n,id:createId('task'),parentId:view==='project'?project:null}))});}catch(error){message(error.message);add.disabled=false;}};
        capture.append(input,add,btn('Bulk entry',bulkEntry),btn('New project',()=>edit(null,'project')));panel.append(capture);
        const tools=document.createElement('div');tools.className='plan-tools';
        const query=document.createElement('input');query.type='search';query.placeholder='Search titles, notes, projects, tags';query.setAttribute('aria-label','Search tasks');query.value=search;
        query.oninput=()=>{search=query.value;renderContent();};tools.append(query);
        for(const [name,value,choices,change]of [['Filter',filter,{all:'All states',ready:'Ready',blocked:'Blocked',overdue:'Overdue',projects:'Projects'},v=>filter=v],['Sort',sort,{sequence:'Time sequence',importance:'Expressed importance',due:'Due / deadline',name:'Name'},v=>sort=v]]){const select=document.createElement('select');select.setAttribute('aria-label',name);for(const [key,label]of Object.entries(choices)){const option=new Option(label,key);option.selected=value===key;select.append(option);}select.onchange=()=>{change(select.value);renderContent();};tools.append(select);}
        tools.append(btn('Sort importance',rank));panel.append(tools);
        const bulk=document.createElement('div');bulk.id='planBulk';bulk.className='plan-actions';panel.append(bulk);renderBulk();
        const warnings=state.forecast.warnings;
        if(warnings.length){const warning=document.createElement('details');warning.className='plan-warnings';const summary=document.createElement('summary');summary.textContent=warnings.length+' planning notes';warning.append(summary);for(const text of warnings){const p=document.createElement('p');p.textContent=text;warning.append(p);}panel.append(warning);}
        const note=document.createElement('p');note.className='plan-toolbar-note';note.textContent=(state.forecast.availabilityMode==='continuous'?'Forecast starts now unless a task has a later start constraint. Working hours are optional; add availability to restrict the timeline. ':`Forecast uses your working intervals with ${Math.round(state.settings.reserve*100)}% reserve for unrecorded obligations. `)+`Importance comes from your comparisons. Time sequence also respects prerequisites and deadlines. Dates displayed in ${Intl.DateTimeFormat().resolvedOptions().timeZone}.`;panel.append(note);
        const content=document.createElement('div');content.id='planContent';panel.append(content);renderContent();
    }
    function renderContent(){
        const content=document.getElementById('planContent');if(!content)return;content.replaceChildren();const rows=list();renderBulk();
        if(view==='matrix'){
            const grid=document.createElement('div');grid.className='plan-grid';
            const labels=['More important · little freedom','More important · time remains','Less important · little freedom','Less important · time remains','Importance or timing uncertain'];
            const groups=labels.map(label=>{const section=document.createElement('section');section.className='plan-column';const h=document.createElement('h3');h.textContent=label;section.append(h);grid.append(section);return section;});
            const ranked=state.forecast.items.filter(i=>i.effectiveImportance!=null).map(i=>i.effectiveImportance).sort((a,b)=>a-b),threshold=ranked[Math.floor(ranked.length/2)]??0;
            for(const n of rows.filter(n=>n.node_type==='task')){const i=item(n.id),high=i?.effectiveImportance<=threshold,urgent=i?.slackMs<=24*3600000;const index=i?.effectiveImportance==null||i?.slackMs==null?4:high?(urgent?0:1):(urgent?2:3);groups[index].append(row(n,true));}
            const explanation=document.createElement('p');explanation.className='muted';explanation.textContent='Illustrative thresholds: upper half of inferred importance; little freedom = latest reserved start within 24 hours. Project and dependent importance can benefit enabling tasks. Unknown timing stays separate.';content.append(explanation,grid);return;
        }
        if(view==='calendar'){
            const groups=new Map();
            for(const n of rows.filter(n=>n.node_type==='task')){const segments=item(n.id)?.segments||[];const entries=segments.length?segments:[{start:n.scheduled_start_at??item(n.id)?.deadlineAt??item(n.id)?.dueAt??n.deadline_at??n.due_at}];for(const segment of entries){const key=segment.start==null?'Unscheduled':new Date(segment.start).toLocaleDateString();if(!groups.has(key))groups.set(key,[]);groups.get(key).push({n,segment});}}
            for(const [key,entries]of groups){const section=document.createElement('section');section.className='plan-day';const h=document.createElement('h3');h.textContent=key;section.append(h);for(const {n,segment}of entries){const label=document.createElement('p');label.className='muted';label.textContent=segment.start==null?'No timing placement':date(segment.start)+(segment.end?' – '+date(segment.end):' · requested date');section.append(label,row(n));}content.append(section);}if(!groups.size)empty(content);return;
        }
        content.className='plan-list';for(const n of rows)content.append(row(n));if(!rows.length)empty(content);
    }
    function empty(content){const box=document.createElement('div');box.className='plan-empty';box.textContent='No work in this view. Capture something above, or change your filters.';content.append(box);}
    function dialog(title){
        document.querySelector('.plan-dialog')?.remove();const d=document.createElement('dialog');d.className='plan-dialog plan-app';const h=document.createElement('h3');h.textContent=title;d.append(h);document.body.append(d);d.addEventListener('close',()=>d.remove());d.showModal();return d;
    }
    function field(form,label,type,value,name){const wrap=document.createElement('label');wrap.textContent=label;const input=document.createElement(type==='textarea'?'textarea':type==='select'?'select':'input');if(!['textarea','select'].includes(type))input.type=type;input.name=name;input.value=value??'';wrap.append(input);form.append(wrap);return input;}
    function parentOptions(select,current,exclude){select.append(new Option('No project / Inbox',''));for(const n of state.nodes.filter(n=>n.node_type==='project'&&n.status!=='cancelled'&&n.id!==exclude)){const o=new Option([path(n),n.name].filter(Boolean).join(' / '),n.id);o.selected=current===n.id;select.append(o);}}
    function bulkEdit(ids){
        const d=dialog('Edit '+ids.length+' selected items'),form=document.createElement('form');d.append(form);
        const note=document.createElement('p');note.className='muted';note.textContent='Only checked fields change. A checked field left blank clears that value. Estimates apply to tasks; project totals stay derived from their components.';form.append(note);
        const rows=ids.map(node),controls=[];
        const common=key=>rows.every(n=>n[key]===rows[0][key])?rows[0][key]:null;
        function add(key,label,type,value,convert){
            const group=document.createElement('div');group.className='plan-bulk-field';
            const applyLabel=document.createElement('label'),apply=document.createElement('input');apply.type='checkbox';apply.setAttribute('aria-label','Change '+label);applyLabel.className='plan-bulk-apply';applyLabel.append(apply,document.createTextNode('Change '+label));group.append(applyLabel);
            const input=field(group,label,type,value,key);input.disabled=true;
            if(type==='number'){input.min=0;input.step='any';}
            if(type==='checkbox')input.checked=value===true;
            apply.onchange=()=>{input.disabled=!apply.checked;};
            controls.push({key,apply,input,convert});form.append(group);
        }
        const ms=input=>input.value===''?null:Math.round(Number(input.value)*60000);
        const timestamp=input=>input.value?new Date(input.value).getTime():null;
        add('estimatedTimeMs','Estimated total minutes','number',common('estimated_ms')>0?common('estimated_ms')/60000:'',input=>ms(input)??0);
        add('remaining_ms','Remaining minutes override','number',common('remaining_ms')==null?'':common('remaining_ms')/60000,ms);
        for(const [key,label]of [['due_at','Preferred due date'],['deadline_at','Hard deadline'],['earliest_start_at','Earliest start'],['scheduled_start_at','Scheduled start']])add(key,label,'datetime-local',local(common(key)),timestamp);
        add('tags','Tags (comma separated)','text',rows.every(n=>JSON.stringify(n.tags)===JSON.stringify(rows[0].tags))?rows[0].tags.join(', '):'',input=>input.value.split(',').map(s=>s.trim()).filter(Boolean));
        for(const [key,label,type]of [['location','Location','text'],['assignee','Assignee','text'],['description','Description','textarea'],['notes','Notes','textarea'],['success_criteria','Success criteria','textarea']])add(key,label,type,common(key)||'',input=>input.value);
        add('splittable','Allow work across multiple intervals','checkbox',common('splittable'),input=>input.checked);
        const error=document.createElement('p');error.className='plan-error';error.setAttribute('role','alert');form.append(error);
        const actions=document.createElement('div');actions.className='plan-actions';const save=btn('Apply changes',()=>{},true);save.type='submit';actions.append(save,btn('Cancel',()=>d.close()));form.append(actions);
        form.onsubmit=async e=>{
            e.preventDefault();const changes={};for(const {key,apply,input,convert}of controls)if(apply.checked)changes[key]=convert(input);
            if(!Object.keys(changes).length){error.textContent='Choose at least one field to change.';return;}
            save.disabled=true;try{await change('/bulk','POST',{ids,changes});d.close();}catch(reason){error.textContent=reason.message;save.disabled=false;}
        };
    }
    function bulkDelete(ids){
        const g=window.PlanDomain.graph(state.nodes,state.dependencies),selection=new Set(ids);
        const affected=state.nodes.filter(n=>selection.has(n.id)||g.ancestors(n.id).some(parent=>selection.has(parent.id)));
        const d=dialog('Delete selected items?'),form=document.createElement('form');d.append(form);
        const note=document.createElement('p');note.textContent=`Delete ${ids.length} selected item${ids.length===1?'':'s'} (${affected.length} item${affected.length===1?'':'s'} including project children)? You can restore deleted work from Archive; recorded work history is kept.`;form.append(note);
        const error=document.createElement('p');error.className='plan-error';error.setAttribute('role','alert');form.append(error);
        const actions=document.createElement('div');actions.className='plan-actions';const remove=btn('Delete items',()=>{});remove.type='submit';remove.className='danger';actions.append(btn('Cancel',()=>d.close()),remove);form.append(actions);
        form.onsubmit=async e=>{e.preventDefault();remove.disabled=true;try{await change('/bulk','POST',{ids,action:'delete'});d.close();}catch(reason){error.textContent=reason.message;remove.disabled=false;}};
    }
    async function edit(id,type='task'){
        const n=id?node(id):{node_type:type,name:'',parent_id:view==='project'?project:null,tags:[]},d=dialog(id?'Edit '+(n.node_type==='project'?'project':'task'):'New '+type),form=document.createElement('form');d.append(form);
        const title=field(form,'Title','text',n.name,'title');title.required=true;title.maxLength=1000;
        const parent=field(form,'Parent project','select','','parent');parentOptions(parent,n.parent_id,id);
        const estimate=field(form,'Estimated total minutes (blank = unknown)','number',n.estimated_ms>0?n.estimated_ms/60000:'','estimate');estimate.min=0;estimate.step='any';if(n.node_type==='project')estimate.disabled=true;
        const description=field(form,'Description','textarea',n.description,'description');description.rows=2;
        const dates=document.createElement('div');dates.className='plan-fields';form.append(dates);
        const due=field(dates,'Preferred due date','datetime-local',local(n.due_at),'due');
        const deadline=field(dates,'Hard deadline','datetime-local',local(n.deadline_at),'deadline');
        const more=document.createElement('details');const summary=document.createElement('summary');summary.textContent='Scheduling, prerequisites & details';more.append(summary);form.append(more);
        const earliest=field(more,'Earliest start','datetime-local',local(n.earliest_start_at),'earliest');
        const scheduled=field(more,'Scheduled start (reserves estimated duration)','datetime-local',local(n.scheduled_start_at),'scheduled');
        const remaining=field(more,'Override remaining minutes (blank = estimate minus recorded work)','number',n.remaining_ms==null?'':n.remaining_ms/60000,'remaining');remaining.min=0;remaining.step='any';
        const split=field(more,'Allow work across multiple intervals','checkbox','','split');split.checked=n.splittable!==false;
        const prereq=field(more,'All prerequisites must complete before this work begins','select','','prerequisites');prereq.multiple=true;
        const sources=state.dependencies.filter(e=>e.task_id===id).map(e=>e.prerequisite_id);
        for(const candidate of state.nodes.filter(n=>n.id!==id&&n.status!=='cancelled')){const option=new Option([path(candidate),candidate.name].filter(Boolean).join(' / '),candidate.id);option.selected=sources.includes(candidate.id);prereq.append(option);}
        const tags=field(more,'Tags (comma separated)','text',n.tags.join(', '),'tags');
        const recurrence=field(more,'Repeat every N calendar days (blank = no repeat)','number',n.recurrence_days,'recurrence');recurrence.min=1;recurrence.max=3650;if(n.node_type==='project')recurrence.disabled=true;
        const notes=field(more,'Notes','textarea',n.notes,'notes');
        const location=field(more,'Location','text',n.location,'location');
        const assignee=field(more,'Assignee (informational; ownership stays yours)','text',n.assignee,'assignee');
        const success=field(more,'Success criteria','textarea',n.success_criteria,'success');
        const position=field(more,'Sibling display position','number',n.position||1,'position');position.min=0;position.step=1;
        const error=document.createElement('p');error.className='plan-error';error.setAttribute('role','alert');form.append(error);
        const actions=document.createElement('div');actions.className='plan-actions';const save=btn('Save',()=>{},true);save.type='submit';actions.append(save,btn('Cancel',()=>d.close()));
        if(id){actions.append(btn('Archive',async()=>{await change('/tasks/'+encodeURIComponent(id),'PUT',{archived:true});d.close();}));actions.append(btn('Delete',async()=>{await change('/tasks/'+encodeURIComponent(id)+'/delete','POST',{});d.close();}));if(n.node_type==='task')actions.append(btn('Convert to project',async()=>{await change('/tasks/'+encodeURIComponent(id),'PUT',{nodeType:'project'});d.close();}));}
        form.append(actions);
        form.onsubmit=async e=>{e.preventDefault();save.disabled=true;try{
            const timestamp=input=>input.value?new Date(input.value).getTime():null;
            const payload={name:title.value.trim(),nodeType:n.node_type,parentId:parent.value||null,estimatedTimeMs:Math.round(Number(estimate.value)*60000),description:description.value,notes:notes.value,location:location.value,assignee:assignee.value,success_criteria:success.value,position:Number(position.value),
                due_at:timestamp(due),deadline_at:timestamp(deadline),earliest_start_at:timestamp(earliest),scheduled_start_at:timestamp(scheduled),remaining_ms:remaining.value===''?null:Math.round(Number(remaining.value)*60000),splittable:split.checked,
                prerequisites:[...prereq.selectedOptions].map(o=>o.value),tags:tags.value.split(',').map(s=>s.trim()).filter(Boolean),recurrence_days:recurrence.value?Number(recurrence.value):null,recurrence_zone:state.settings.timezone};
            await change(id?'/tasks/'+encodeURIComponent(id):'/tasks',id?'PUT':'POST',id?payload:{tasks:[{...payload,id:createId('task')}]});d.close();
        }catch(reason){error.textContent=reason.message;save.disabled=false;}};
        title.focus();
    }
    function bulkEntry(){const d=dialog('Capture several tasks'),form=document.createElement('form');d.append(form);const input=field(form,'One task per line; optional “, 15m”','textarea','','tasks');input.rows=8;input.required=true;const error=document.createElement('p');error.className='plan-error';form.append(error);const save=btn('Add tasks',()=>{},true);save.type='submit';form.append(save,btn('Cancel',()=>d.close()));form.onsubmit=async e=>{e.preventDefault();const parsed=window.TaskEntry.parse(input.value);if(parsed.invalid.length||!parsed.entries.length){error.textContent='Check task durations and names.';return;}save.disabled=true;try{await change('/tasks','POST',{tasks:parsed.entries.map(n=>({...n,id:createId('task'),parentId:view==='project'?project:null}))});d.close();}catch(reason){error.textContent=reason.message;save.disabled=false;}};}
    function move(ids){const d=dialog('Move selected work'),form=document.createElement('form');d.append(form);const parent=field(form,'Destination project','select','','parent');parentOptions(parent,null,null);const error=document.createElement('p');error.className='plan-error';form.append(error);const save=btn('Move',()=>{},true);save.type='submit';form.append(save,btn('Cancel',()=>d.close()));form.onsubmit=async e=>{e.preventDefault();try{await change('/bulk','POST',{ids,changes:{parentId:parent.value||null}});d.close();}catch(reason){error.textContent=reason.message;}};}
    function availability(){
        const d=dialog('Available working time'),form=document.createElement('form');d.append(form);
        const note=document.createElement('p');note.className='muted';note.textContent='Optional: restrict the calendar to available working intervals. With no intervals, planning begins now unless a task has a later start. Reserve applies to explicit intervals. Past intervals do not create future capacity.';form.append(note);
        const timezone=field(form,'Calendar timezone','text',state.settings.timezone,'timezone');
        const reserve=field(form,'Reserve for unrecorded work (%)','number',Math.round(state.settings.reserve*100),'reserve');reserve.min=0;reserve.max=80;
        const windows=[...state.windows];const list=document.createElement('div');form.append(list);
        function draw(){list.replaceChildren();windows.forEach((w,index)=>{const group=document.createElement('div');group.className='plan-fields';const start=field(group,'Available from','datetime-local',local(w.start),'start'+index),end=field(group,'Until','datetime-local',local(w.end),'end'+index);start.onchange=()=>w.start=new Date(start.value).getTime();end.onchange=()=>w.end=new Date(end.value).getTime();list.append(group,btn('Remove interval',()=>{windows.splice(index,1);draw();}));});}
        draw();form.append(btn('Add interval',()=>{const start=Date.now();windows.push({start,end:start+2*3600000});draw();}),btn('Next 7 weekdays, 9–5',()=>{windows.length=0;for(let i=0;i<10&&windows.length<7;i++){const start=new Date();start.setDate(start.getDate()+i);start.setHours(9,0,0,0);if([0,6].includes(start.getDay()))continue;windows.push({start:start.getTime(),end:start.getTime()+8*3600000});}draw();}));
        const error=document.createElement('p');error.className='plan-error';form.append(error);const save=btn('Save availability',()=>{},true);save.type='submit';form.append(save,btn('Cancel',()=>d.close()));form.onsubmit=async e=>{e.preventDefault();save.disabled=true;try{await change('/settings','PUT',{timezone:timezone.value,reserve:Number(reserve.value)/100,windows});d.close();}catch(reason){error.textContent=reason.message;save.disabled=false;}};
    }
    async function rank(){
        const rows=selected.size?[...selected].map(node):list();if(rows.length<2)return message('Choose at least two tasks or projects to compare.');
        const d=dialog('Which matters more?'),p=document.createElement('p');p.className='muted';p.textContent='Compare importance, even when prerequisites mean the other item must happen first.';d.append(p);
        const choices=document.createElement('div');choices.className='plan-list';d.append(choices);let stopped=false;
        d.addEventListener('close',()=>{stopped=true;resolveChoice?.(null);});let resolveChoice;
        const compare=(a,b)=>new Promise(resolve=>{resolveChoice=resolve;choices.replaceChildren(btn(a.name,()=>resolve(a.id)),btn(b.name,()=>resolve(b.id)));});
        async function mergeSort(items){if(items.length<2)return items;const mid=Math.floor(items.length/2),a=await mergeSort(items.slice(0,mid)),b=await mergeSort(items.slice(mid)),out=[];while(a.length&&b.length&&!stopped){const winner=await compare(a[0],b[0]);if(!winner)break;out.push(winner===a[0].id?a.shift():b.shift());}return [...out,...a,...b];}
        const result=await mergeSort(rows);if(stopped)return;choices.textContent='Saving comparisons…';await change('/rank','POST',{ids:result.map(n=>n.id)});d.close();
    }
    async function work(){
        await load();const candidates=state.forecast.schedule.map(s=>node(s.id));
        // Without availability, still permit explicitly selected/ready work.
        const rows=(selected.size?[...selected].map(node):candidates.length?candidates:state.nodes.filter(n=>item(n.id)?.ready)).filter(n=>n?.node_type==='task'&&openNode(n));
        if(!rows.length)return message('No executable work selected. Resolve prerequisites or add estimates and availability.');
        if(rows.some(n=>n.estimated_ms<=0))return message('Estimate selected tasks before starting timed work.');
        await window.TaskGraph.flush();
        document.body.classList.remove('planning');
        const g=window.PlanDomain.graph(state.nodes,state.dependencies);
        sortedTasks=rows.map(n=>{const ancestors=g.ancestors(n.id).reverse();const task=createTask([...ancestors.map(a=>a.name),n.name].join(': '),{id:n.id,estimatedTimeMs:n.estimated_ms,actualTimeMs:n.actual_ms,status:n.status,created:n.created,started:n.started,lastChanged:null});Object.assign(task,{canonicalName:n.name,parentId:n.parent_id,nodeType:'task',nodePosition:n.position,independentlyActionable:true,projectAncestorIds:ancestors.map(a=>a.id),projectAncestorNames:ancestors.map(a=>a.name),projectPath:ancestors.map(a=>a.name).join(' › ')});return task;});
        window.currentWorkProjectContext=null;window.FocusDurability.newWork();clearSessionTiming();activeTaskId=firstIncompleteTask()?.id||null;await window.FocusDurability.prepare();showDashboard();
    }
    const execution={
        data:null,adopt(data){this.data=data;},
        async refresh(){if(window.taskSorterMode!=='guest')this.data=await request();},
        allowed(task){
            if(!this.data)return true;
            const nodes=this.data.nodes.map(n=>{const queued=sortedTasks.find(t=>t.id===n.id);return queued?{...n,status:queued.completed?'completed':queued.status}:n;});
            if(!nodes.some(n=>n.id===task.id))return true;
            try{const g=window.PlanDomain.graph(nodes,this.data.dependencies);const n=g.byId.get(task.id);return !g.blocked(task.id).length&&[n,...g.ancestors(n.id)].every(n=>(n.earliest_start_at||0)<=Date.now()&&(n.scheduled_start_at||0)<=Date.now());}catch(_){return false;}
        }
    };
    window.PlanExecution=execution;
    if(window.taskSorterMode!=='guest'){
        const original=window.FocusDurability.init;window.FocusDurability.init=async()=>{await execution.refresh();return original();};
        document.getElementById('planBtn').onclick=()=>open('inbox',null);
        document.getElementById('insightsBtn')?.remove();document.getElementById('metricsBtn')?.remove();
        const home=window.showModeSelect;window.showModeSelect=function(){document.body.classList.remove('planning');return home();};
        const back=btn('Open Plan',()=>open());back.id='savedPlanNav';back.style.marginLeft='8px';document.getElementById('sessionMenu')?.append(back);
    }
    const link=document.createElement('link');link.rel='stylesheet';link.href='/frontend/plan.css?v=vnext1';document.head.append(link);
    document.addEventListener('visibilitychange',()=>{if(!document.hidden&&document.getElementById('nextPlan')&&!document.querySelector('dialog'))open();});
    setInterval(()=>{if(!document.hidden&&document.getElementById('nextPlan')&&!document.querySelector('dialog')&&document.activeElement?.tagName!=='INPUT')open();},60000);
    async function recordImportance(rows){
        if(window.taskSorterMode==='guest'||rows.length<2)return;
        await window.TaskGraph.commit('importance comparisons',[{path:'/plan/rank',method:'POST',body:{ids:rows.map(n=>n.id),requestId:createId('importance')}}]);
        await execution.refresh();
    }
    return {open,edit,work,recordImportance};
})();
