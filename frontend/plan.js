'use strict';
window.NextPlan=(()=>{
    const request=(path='',method='GET',body)=>window.TaskGraph.request('/plan'+path,method,body);
    const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const minute=value=>value==null?'?':Math.round(value/60000);
    const local=value=>value==null?'':new Date(value-new Date(value).getTimezoneOffset()*60000).toISOString().slice(0,16);
    const date=value=>value==null?'':new Date(value).toLocaleString([], {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
    let state=null,view='inbox',project=null,search='',filter='all',sort='sequence',selected=new Set(),generation=0;
    let panel,captureBusy=false;
    const openNode=n=>n.status!=='cancelled'&&!n.archived&&n.status!=='completed';
    const btn=(label,fn,primary=false)=>{const b=document.createElement('button');b.type='button';b.textContent=label;b.onclick=()=>Promise.resolve().then(fn).catch(error=>message(error.message));if(primary)b.className='primary';return b;};
    function message(value){const target=document.getElementById('planMessage');if(target)target.textContent=value;else alert(value);}
    const node=id=>state.nodes.find(n=>n.id===id);
    const item=id=>state.forecast.items.find(n=>n.id===id);
    async function load(){state=await request();selected=new Set([...selected].filter(id=>state.nodes.some(n=>n.id===id)));execution.adopt(state);return state;}
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
        if(window.AppNavigation&&!window.AppNavigation.restoring)window.AppNavigation.go('plan',{view:next,project:id});
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
            if(view==='inbox')return !n.parent_id&&n.node_type==='task'&&n.independently_actionable!==0;
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
        const content=document.createElement('div'),title=document.createElement('a'),isProject=n.node_type==='project'&&openNode(n);
        title.textContent=n.name;title.className='title';title.href='#app/'+encodeURIComponent(JSON.stringify(isProject?{screen:'plan',view:'project',project:n.id}:{screen:'plan',view,project,edit:n.id}));
        title.onclick=e=>{if(e.ctrlKey||e.metaKey||e.shiftKey||e.altKey)return;e.preventDefault();Promise.resolve(isProject?open('project',n.id):edit(n.id)).catch(error=>message(error.message));};content.append(title);
        const meta=document.createElement('div');meta.className='meta';
        const compared=state.comparisons.some(c=>(c.higher_id===n.id||c.lower_id===n.id)&&node(c.higher_id)?.parent_id===node(c.lower_id)?.parent_id);
        const bits=[compared?'Compared':'Unsorted',n.node_type==='project'?`${n.progress.completed}/${n.progress.total} components complete`:n.status,`${minute(n.progress.remainingMs)} min remaining`,`${minute(n.progress.actualMs)} min worked`];
        if(path(n))bits.unshift(path(n));if(n.due_at)bits.push('Due '+date(n.due_at));if(n.deadline_at)bits.push('Deadline '+date(n.deadline_at));if(n.recurrence_days)bits.push(`Every ${n.recurrence_days} days`);bits.push(...n.tags.map(t=>'#'+t));meta.textContent=bits.join(' · ');content.append(meta);
        if(n.node_type==='project'&&n.progress.total){const progress=document.createElement('progress');progress.max=n.progress.total;progress.value=n.progress.completed;progress.setAttribute('aria-label','Completed components');content.append(progress);}
        if(forecast){const reason=document.createElement('div');reason.className='reason';reason.textContent=(forecast.start!=null?date(forecast.start)+' · ':'')+(forecast.blockedBy.length?'Waiting for '+forecast.blockedBy.join(', '):forecast.reason);content.append(reason);}
        element.append(content);
        if(!compact){const actions=document.createElement('div');actions.className='plan-actions';if(n.node_type==='project')actions.append(btn('Project settings',()=>edit(n.id)));
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
        target.append(btn('Edit selected',()=>bulkEdit(ids)),btn('Complete',()=>change('/bulk','POST',{ids,changes:{status:'completed'}})),btn('Reopen',()=>change('/bulk','POST',{ids,changes:{status:'pending'}})),btn('Move',()=>move(ids)),btn('Delete selected',()=>bulkDelete(ids)));
    }
    function render(){
        shell();
        const heading=document.createElement('header');heading.className='plan-head';
        const title=document.createElement('div');title.innerHTML='<span class="muted">NEXTTASK · PLAN</span><h2>'+esc(view==='project'?node(project)?.name||'Project':({inbox:'Backlog',all:'Your landscape',projects:'Projects',today:'Today',upcoming:'Upcoming',agenda:'Agenda',calendar:'Calendar',matrix:'Importance & urgency',completed:'Completed work',archive:'Archived work'})[view])+'</h2>';
        const actions=document.createElement('div');actions.className='plan-actions';actions.append(btn('Work',()=>work()),btn('Working hours',workingHours),btn('Availability',availability),btn('Refresh',()=>open()),btn('Home',()=>{document.body.classList.remove('planning');showModeSelect();}));heading.append(title,actions);panel.append(heading);
        const nav=document.createElement('nav');nav.className='plan-nav';nav.setAttribute('aria-label','Plan views');
        for(const [key,label]of Object.entries({inbox:'Backlog',all:'All work',projects:'Projects',today:'Today',upcoming:'Upcoming',agenda:'Agenda',calendar:'Calendar',matrix:'Matrix',completed:'Completed',archive:'Archive'})){const b=btn(label,()=>{selected.clear();return key==='agenda'?window.Agenda.show():key==='calendar'?window.Agenda.calendar():open(key,null);});if(view===key)b.setAttribute('aria-current','page');nav.append(b);}panel.append(nav);
        const status=document.createElement('p');status.id='planMessage';status.className='plan-error';status.setAttribute('role','status');panel.append(status);
        if(view==='project'){
            const n=node(project),summary=document.createElement('div');summary.className='plan-stats';summary.textContent=`${n.progress.completed}/${n.progress.total} components completed · ${minute(n.progress.remainingMs)} min remaining · ${minute(n.progress.actualMs)} min recorded`;
            panel.append(summary,btn('Edit project',()=>edit(project)),btn('Parent',()=>n.parent_id?open('project',n.parent_id):open('projects',null)));
        }
        const capture=document.createElement('form');capture.className='plan-capture';
        const input=document.createElement('input');input.placeholder='Capture a task, optionally with “, 15m”';input.setAttribute('aria-label','Quick add task');input.required=true;
        const add=btn('Add task',()=>{},true);add.type='submit';capture.onsubmit=async e=>{
            e.preventDefault();const parsed=window.TaskEntry.parse(input.value);
            if(parsed.invalid.length||!parsed.entries.length)return message('Enter a task, optionally followed by a duration.');
            if(parsed.entries.length===1)await edit(null,'task',input.value);
            else bulkEntry(input.value);
        };
        capture.append(input,add,btn('Bulk entry',bulkEntry),btn('New project',()=>edit(null,'project')));for(const control of capture.querySelectorAll('input,button'))control.disabled=captureBusy;panel.append(capture);
        const tools=document.createElement('div');tools.className='plan-tools';
        const query=document.createElement('input');query.type='search';query.placeholder='Search titles, notes, projects, tags';query.setAttribute('aria-label','Search tasks');query.value=search;
        query.oninput=()=>{search=query.value;renderContent();};tools.append(query);
        for(const [name,value,choices,change]of [['Filter',filter,{all:'All states',ready:'Ready',blocked:'Blocked',overdue:'Overdue',projects:'Projects'},v=>filter=v],['Sort',sort,{sequence:'Time sequence',importance:'Expressed importance',due:'Due / deadline',name:'Name'},v=>sort=v]]){const select=document.createElement('select');select.setAttribute('aria-label',name);for(const [key,label]of Object.entries(choices)){const option=new Option(label,key);option.selected=value===key;select.append(option);}select.onchange=()=>{change(select.value);renderContent();};tools.append(select);}
        tools.append(btn('Sort importance',rank));panel.append(tools);
        const bulk=document.createElement('div');bulk.id='planBulk';bulk.className='plan-actions';panel.append(bulk);renderBulk();
        const warnings=state.forecast.warnings;
        if(warnings.length){const warning=document.createElement('details');warning.className='plan-warnings';const summary=document.createElement('summary');summary.textContent=warnings.length+' planning notes';warning.append(summary);for(const text of warnings){const p=document.createElement('p');p.textContent=text;warning.append(p);}panel.append(warning);}
        const note=document.createElement('p');note.className='plan-toolbar-note';note.textContent=(state.forecast.availabilityMode==='continuous'?'Forecast starts now unless a task has a later start constraint. Set Working hours to follow your usual weekly schedule. ':state.forecast.availabilityMode==='weekly'?`Forecast follows your weekly working hours in ${state.settings.timezone}, plus any dated availability, using all available time. `:`Forecast uses your working intervals using all available time. `)+`Importance comes from your comparisons. Time sequence also respects prerequisites and deadlines. Dates displayed in ${Intl.DateTimeFormat().resolvedOptions().timeZone}.`;panel.append(note);
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
        if(view==='agenda'){
            const groups=new Map();
            for(const n of rows.filter(n=>n.node_type==='task')){const segments=item(n.id)?.segments||[];const entries=segments.length?segments:[{start:item(n.id)?.start??null,end:item(n.id)?.end??null}];for(const segment of entries){const key=segment.start==null?'Unscheduled':new Date(segment.start).toLocaleDateString();if(!groups.has(key))groups.set(key,[]);groups.get(key).push({n,segment});}}
            for(const [key,entries]of groups){const section=document.createElement('section');section.className='plan-day';const h=document.createElement('h3');h.textContent=key;section.append(h);for(const {n,segment}of entries){const label=document.createElement('p');label.className='muted';label.textContent=segment.start==null?'No timing placement':date(segment.start)+(segment.end?' – '+date(segment.end):' · requested date');section.append(label,row(n));}content.append(section);}if(!groups.size)empty(content);return;
        }
        content.className='plan-list';
        if(view==='inbox'&&rows.length){
            const compared=n=>state.comparisons.some(c=>(c.higher_id===n.id||c.lower_id===n.id)&&node(c.higher_id)?.parent_id===node(c.lower_id)?.parent_id);
            const note=document.createElement('p');note.className='muted';note.textContent='Completion and importance are separate. Compared work has saved importance evidence; unsorted work still needs placement. Time sequence can differ from importance.';content.append(note);
            for(const [label,match]of [['Compared unfinished work',true],['Unsorted pending work',false]]){const section=rows.filter(n=>compared(n)===match);if(!section.length)continue;const h=document.createElement('h3');h.textContent=label;content.append(h,...section.map(n=>row(n)));}
        }else for(const n of rows)content.append(row(n));if(!rows.length)empty(content);
    }
    function empty(content){const box=document.createElement('div');box.className='plan-empty';box.textContent='No work in this view. Capture something above, or change your filters.';content.append(box);}
    function dialog(title){
        document.querySelector('.plan-dialog')?.remove();const d=document.createElement('dialog');d.className='plan-dialog plan-app';const h=document.createElement('h3');h.textContent=title;d.append(h);document.body.append(d);d.addEventListener('close',()=>d.remove());d.showModal();return d;
    }
    function field(form,label,type,value,name){const wrap=document.createElement('label');wrap.textContent=label;const input=document.createElement(type==='textarea'?'textarea':type==='select'?'select':'input');if(!['textarea','select'].includes(type))input.type=type;input.name=name;input.value=value??'';wrap.append(input);form.append(wrap);return input;}
    function parentOptions(select,current,exclude){select.append(new Option('No project / Backlog',''));for(const n of state.nodes.filter(n=>(n.node_type==='project'||n.id===current)&&n.status!=='cancelled'&&n.id!==exclude)){const o=new Option([path(n),n.name].filter(Boolean).join(' / '),n.id);o.selected=current===n.id;select.append(o);}}
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
    async function edit(id,type='task',initial='',onCreated){
        if(window.AppNavigation&&!window.AppNavigation.restoring)window.AppNavigation.go('plan',{view,project,edit:id||'new',type,initial});
        const n=id?node(id):{node_type:type,name:initial,parent_id:view==='project'?project:null,tags:[]},d=dialog(id?'Edit '+(n.node_type==='project'?'project':'task'):'New '+type),form=document.createElement('form');d.append(form);
        if(!id&&initial){const parsed=window.TaskEntry.parse(initial);if(parsed.entries.length===1){n.name=parsed.entries[0].name;n.estimated_ms=parsed.entries[0].estimatedTimeMs;}}
        const draftKey='nexttaskEdit_'+userId+'_'+(id||'new_'+(project||'root'));
        const title=field(form,'Title','text',n.name,'title');title.required=true;title.maxLength=1000;
        const parent=field(form,'Parent project','select','','parent');parentOptions(parent,n.parent_id,id);
        const estimate=field(form,'Estimated total minutes (blank = unknown)','number',n.estimated_ms>0?n.estimated_ms/60000:'','estimate');estimate.min=0;estimate.step='any';if(n.node_type==='project')estimate.disabled=true;const projectTask=!id&&n.node_type==='task'&&!!n.parent_id;if(projectTask){estimate.required=true;estimate.min=0.000001;}
        const description=field(form,'Description','textarea',n.description,'description');description.rows=2;
        const dates=document.createElement('div');dates.className='plan-fields';form.append(dates);
        const due=field(dates,'Preferred due date','datetime-local',local(n.due_at),'due');
        const deadline=field(dates,'Hard deadline','datetime-local',local(n.deadline_at),'deadline');
        const needsDeadline=!id&&n.node_type==='task';deadline.required=needsDeadline;
        const noDeadline=needsDeadline?field(dates,'No deadline','checkbox','','noDeadline'):null;
        const syncDeadline=()=>{if(!noDeadline)return;deadline.disabled=noDeadline.checked;deadline.required=!noDeadline.checked;if(noDeadline.checked)deadline.value='';};
        if(noDeadline)noDeadline.onchange=syncDeadline;
        parent.onchange=()=>{const required=!id&&n.node_type==='task'&&!!parent.value;estimate.required=required;estimate.min=required?0.000001:0;};
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
        if(id){actions.append(btn('Archive (hide from active views)',async()=>{await change('/tasks/'+encodeURIComponent(id),'PUT',{archived:true});d.close();}));actions.append(btn('Delete',async()=>{if(!confirm('Delete this item and its components? Recorded work is preserved and deletion can be restored from Archive.'))return;await change('/tasks/'+encodeURIComponent(id)+'/delete','POST',{});d.close();}));if(n.node_type==='task')actions.append(btn('Convert to project',async()=>{await change('/tasks/'+encodeURIComponent(id),'PUT',{nodeType:'project'});d.close();}));}
        form.append(actions);
        form.onsubmit=async e=>{e.preventDefault();save.disabled=true;try{
            const timestamp=input=>input.value?new Date(input.value).getTime():null;
            const payload={name:title.value.trim(),nodeType:n.node_type,parentId:parent.value||null,estimatedTimeMs:Math.round(Number(estimate.value)*60000),description:description.value,notes:notes.value,location:location.value,assignee:assignee.value,success_criteria:success.value,position:Number(position.value),
                due_at:timestamp(due),deadline_at:timestamp(deadline),earliest_start_at:timestamp(earliest),scheduled_start_at:timestamp(scheduled),remaining_ms:remaining.value===''?null:Math.round(Number(remaining.value)*60000),splittable:split.checked,
                prerequisites:[...prereq.selectedOptions].map(o=>o.value),tags:tags.value.split(',').map(s=>s.trim()).filter(Boolean),recurrence_days:recurrence.value?Number(recurrence.value):null,recurrence_zone:state.settings.timezone};
            if(needsDeadline&&payload.deadline_at!=null&&payload.deadline_at<Date.now())throw new Error('Choose a future deadline or No deadline.');
            const createdId=id||createId('task');
            await change(id?'/tasks/'+encodeURIComponent(id):'/tasks',id?'PUT':'POST',id?payload:{capture:true,tasks:[{...payload,id:createdId}]});d.close();
            if(!id&&payload.nodeType==='task')await finishCapture([createdId],onCreated?()=>onCreated(createdId):null);
            else if(!id&&onCreated)await onCreated(createdId);
        }catch(reason){if(d.open)error.textContent=reason.message;else message(reason.message);save.disabled=false;}};
        try{const saved=JSON.parse(sessionStorage.getItem(draftKey));if(saved)for(const control of form.elements){if(!control.name||!(control.name in saved))continue;if(control.type==='checkbox')control.checked=saved[control.name];else if(control.multiple){for(const option of control.options)option.selected=saved[control.name].includes(option.value);}else control.value=saved[control.name];}}catch(_){}
        syncDeadline();
        form.addEventListener('input',()=>{const draft={};for(const control of form.elements){if(control.name)draft[control.name]=control.type==='checkbox'?control.checked:control.multiple?[...control.selectedOptions].map(o=>o.value):control.value;}sessionStorage.setItem(draftKey,JSON.stringify(draft));});
        d.addEventListener('close',()=>{if(window.AppNavigation&&!window.AppNavigation.restoring&&history.state?.route?.edit)window.AppNavigation.go('plan',{view,project},true);});
        const submit=form.onsubmit;form.onsubmit=async event=>{await submit(event);if(!d.open)sessionStorage.removeItem(draftKey);};
        title.focus();
    }
    async function finishCapture(ids,onDone){
        const targetView=view,targetProject=project,parents=new Set(ids.map(id=>node(id).parent_id||''));
        captureBusy=true;if(document.getElementById('nextPlan'))render();
        try{
            for(const parent of parents)await rank(state.nodes.filter(row=>(row.parent_id||'')===parent&&openNode(row)),true,true);
            const back=onDone||(()=>open(targetView,targetProject));
            const agenda=await request('/agenda');
            if(agenda.agenda.length)await window.Agenda.plan({autoSave:true,onSaved:back});
            else await back();
        }finally{captureBusy=false;if(document.getElementById('nextPlan'))render();}
    }
    function bulkEntry(initial=''){
        const d=dialog('Capture several tasks'),form=document.createElement('form');d.append(form);
        const input=field(form,'One task per line; optional “, 15m”','textarea',initial,'tasks');input.rows=8;input.required=true;
        const deadline=field(form,'Deadline for these tasks','datetime-local','','deadline');deadline.required=true;
        const none=field(form,'No deadline','checkbox','','noDeadline');none.onchange=()=>{deadline.disabled=none.checked;deadline.required=!none.checked;if(none.checked)deadline.value='';};
        const error=document.createElement('p');error.className='plan-error';form.append(error);
        const save=btn('Add tasks',()=>{},true);save.type='submit';form.append(save,btn('Cancel',()=>d.close()));
        form.onsubmit=async e=>{
            e.preventDefault();const parsed=window.TaskEntry.parse(input.value);
            if(parsed.invalid.length||!parsed.entries.length||view==='project'&&parsed.entries.some(n=>n.estimatedTimeMs<=0)){error.textContent='Check task durations and names. Project tasks require an estimate.';return;}
            const due=none.checked?null:new Date(deadline.value).getTime();
            if(due!==null&&(!Number.isFinite(due)||due<Date.now())){error.textContent='Choose a future deadline or No deadline.';return;}
            save.disabled=true;
            try{
                const tasks=parsed.entries.map(n=>({...n,id:createId('task'),parentId:view==='project'?project:null,deadline_at:due}));
                await change('/tasks','POST',{capture:true,tasks});d.close();await finishCapture(tasks.map(n=>n.id));
            }catch(reason){if(d.open)error.textContent=reason.message;else message(reason.message);save.disabled=false;}
        };
    }
    function move(ids){const d=dialog('Move selected work'),form=document.createElement('form');d.append(form);const parent=field(form,'Destination project','select','','parent');parentOptions(parent,null,null);const error=document.createElement('p');error.className='plan-error';form.append(error);const save=btn('Move',()=>{},true);save.type='submit';form.append(save,btn('Cancel',()=>d.close()));form.onsubmit=async e=>{e.preventDefault();try{await change('/bulk','POST',{ids,changes:{parentId:parent.value||null}});d.close();}catch(reason){error.textContent=reason.message;}};}
    function workingHours(){
        const d=dialog('Working hours'),form=document.createElement('form');d.append(form);
        const note=document.createElement('p');note.className='muted';note.textContent='Choose your normal workdays and times. These hours repeat every week in the selected timezone, including daylight-saving changes. Add more periods for breaks. An end at or before the start means the shift ends the next day. No selected days means no regular working time. Save to enable this schedule.';form.append(note);
        const timezone=field(form,'Working-hours timezone','text',state.settings.timezone,'timezone');timezone.required=true;
        const zones=document.createElement('datalist');zones.id='workingHoursZones';
        for(const zone of new Set(['UTC',state.settings.timezone,Intl.DateTimeFormat().resolvedOptions().timeZone,...(Intl.supportedValuesOf?.('timeZone')||[])])){const option=document.createElement('option');option.value=zone;zones.append(option);}
        timezone.setAttribute('list',zones.id);form.append(zones);
        const clock=minute=>String(Math.floor(minute%1440/60)).padStart(2,'0')+':'+String(minute%60).padStart(2,'0');
        const minutes=value=>{const [hour,minute]=value.split(':').map(Number);return hour*60+minute;};
        const existing=state.settings.workingHours||[],defaults=existing.length||state.settings.workingHoursEnabled?existing:[1,2,3,4,5].map(weekday=>({weekday,startMinute:540,endMinute:1020}));
        const days=[['Monday',1],['Tuesday',2],['Wednesday',3],['Thursday',4],['Friday',5],['Saturday',6],['Sunday',0]].map(([name,weekday])=>({name,weekday,periods:defaults.filter(p=>p.weekday===weekday).map(p=>({start:clock(p.startMinute),end:clock(p.endMinute)}))}));
        const list=document.createElement('div');list.className='working-hours-list';form.append(list);
        function draw(){
            list.replaceChildren();
            for(const day of days){
                const section=document.createElement('section');section.className='working-hours-day';
                const label=document.createElement('label'),enabled=document.createElement('input');label.className='plan-select-all';enabled.type='checkbox';enabled.checked=day.periods.length>0;enabled.setAttribute('aria-label','Work on '+day.name);label.append(enabled,document.createTextNode(day.name));section.append(label);
                enabled.onchange=()=>{day.periods=enabled.checked?[{start:'09:00',end:'17:00'}]:[];draw();};
                day.periods.forEach((period,index)=>{
                    const row=document.createElement('div');row.className='working-hours-period';
                    const start=field(row,'From','time',period.start,day.weekday+'-start-'+index),end=field(row,'Until','time',period.end,day.weekday+'-end-'+index);
                    start.required=end.required=true;start.step=end.step=60;start.setAttribute('aria-label',day.name+' start '+(index+1));end.setAttribute('aria-label',day.name+' end '+(index+1));
                    start.onchange=()=>period.start=start.value;end.onchange=()=>period.end=end.value;
                    row.append(btn('Remove period',()=>{day.periods.splice(index,1);draw();}));section.append(row);
                });
                if(day.periods.length)section.append(btn('Add period',()=>{const start=minutes(day.periods.at(-1).end);day.periods.push({start:clock(start),end:clock((start+60)%1440)});draw();}));
                list.append(section);
            }
        }
        draw();
        const error=document.createElement('p');error.className='plan-error';error.setAttribute('role','alert');form.append(error);
        const actions=document.createElement('div');actions.className='plan-actions';const save=btn('Save working hours',()=>{},true);save.type='submit';actions.append(save,btn('Cancel',()=>d.close()));
        if(state.settings.workingHoursEnabled)actions.append(btn('Turn off weekly hours',async()=>{try{await change('/settings','PUT',{workingHoursEnabled:false});d.close();}catch(reason){error.textContent=reason.message;}}));
        form.append(actions);
        form.onsubmit=async e=>{
            e.preventDefault();save.disabled=true;
            try{
                const periods=days.flatMap(day=>day.periods.map(period=>{const startMinute=minutes(period.start);let endMinute=minutes(period.end);if(endMinute<=startMinute)endMinute+=1440;return {weekday:day.weekday,startMinute,endMinute};}));
                window.PlanDomain.validateWorkingHours(periods);
                await change('/settings','PUT',{timezone:timezone.value,workingHoursEnabled:true,workingHours:periods});d.close();
            }catch(reason){error.textContent=reason.message;save.disabled=false;}
        };
    }
    function availability(){
        const d=dialog('Available working time'),form=document.createElement('form');d.append(form);
        const note=document.createElement('p');note.className='muted';note.textContent=state.settings.workingHoursEnabled?'Weekly working hours are active. Dated intervals here add one-off working time, including time outside your normal schedule. Overlaps count only once.':'Set recurring days and times with Working hours, or list dated working intervals here. With neither configured, planning begins now unless a task has a later start. Past intervals do not create future capacity.';form.append(note);
        const timezone=field(form,'Calendar timezone','text',state.settings.timezone,'timezone');
        const windows=[...state.windows];const list=document.createElement('div');form.append(list);
        function draw(){list.replaceChildren();windows.forEach((w,index)=>{const group=document.createElement('div');group.className='plan-fields';const start=field(group,'Available from','datetime-local',local(w.start),'start'+index),end=field(group,'Until','datetime-local',local(w.end),'end'+index);start.onchange=()=>w.start=new Date(start.value).getTime();end.onchange=()=>w.end=new Date(end.value).getTime();list.append(group,btn('Remove interval',()=>{windows.splice(index,1);draw();}));});}
        draw();form.append(btn('Add interval',()=>{const start=Date.now();windows.push({start,end:start+2*3600000});draw();}),btn('Next 7 weekdays, 9–5',()=>{windows.length=0;for(let i=0;i<10&&windows.length<7;i++){const start=new Date();start.setDate(start.getDate()+i);start.setHours(9,0,0,0);if([0,6].includes(start.getDay()))continue;windows.push({start:start.getTime(),end:start.getTime()+8*3600000});}draw();}));
        const error=document.createElement('p');error.className='plan-error';form.append(error);const save=btn('Save availability',()=>{},true);save.type='submit';form.append(save,btn('Cancel',()=>d.close()));form.onsubmit=async e=>{e.preventDefault();save.disabled=true;try{await change('/settings','PUT',{timezone:timezone.value,windows});d.close();}catch(reason){error.textContent=reason.message;save.disabled=false;}};
    }
    async function rank(input,inserting=false,required=false){
        const rows=Array.isArray(input)?input:selected.size?[...selected].map(node):list();
        const savedAgenda=inserting?(await request('/agenda')).agenda:[];
        const groups=new Map();for(const n of rows){const key=n.parent_id||'';if(!groups.has(key))groups.set(key,[]);groups.get(key).push(n);}
        if(![...groups.values()].some(g=>g.length>1))return required?undefined:message('Choose at least two siblings to compare.');
        for(const siblings of groups.values()){
            if(siblings.length<2)continue;
            const key='nexttaskImportance_'+userId+'_'+(siblings[0].parent_id||'root');
            const signature=siblings.map(n=>n.id).sort().join('|');
            let draft;try{draft=JSON.parse(localStorage.getItem(key));}catch(_){}
            if(draft?.signature!==signature){
                const ranked=window.PlanDomain.importance(siblings,state.comparisons);
                const savedIds=savedAgenda.filter(n=>siblings.some(s=>s.id===n.id)).sort((a,b)=>a.importance_rank-b.importance_rank).map(n=>n.id);
                const ordered=inserting?(savedIds.length?savedIds:ranked.order.filter(id=>ranked.known.has(id))):[];
                draft={signature,ordered,pending:siblings.map(n=>n.id).filter(id=>!ordered.includes(id)),low:0,high:ordered.length};
            }
            const d=dialog('What’s more important?');if(required)d.addEventListener('cancel',event=>event.preventDefault());const note=document.createElement('p'),choices=document.createElement('div');
            note.textContent='Compare '+(siblings[0].parent_id?node(siblings[0].parent_id)?.name+' components':'root tasks and projects')+'. Prerequisites can happen first regardless of importance. Progress saves after each choice.';
            choices.className='plan-list';d.append(note,choices);
            let resolveClose;const finished=new Promise(resolve=>resolveClose=resolve);let saved=false;
            d.addEventListener('close',()=>resolveClose(saved),{once:true});
            async function draw(){
                while(draft.pending.length&&draft.low===draft.high){draft.ordered.splice(draft.low,0,draft.pending.shift());draft.low=0;draft.high=draft.ordered.length;}
                localStorage.setItem(key,JSON.stringify(draft));
                if(!draft.pending.length){
                    try{await change('/rank','POST',{ids:draft.ordered});localStorage.removeItem(key);saved=true;d.close();}catch(error){choices.replaceChildren(btn('Retry saving',draw));message(error.message);}return;
                }
                const candidate=draft.pending[0],mid=Math.floor((draft.low+draft.high)/2),peer=draft.ordered[mid];
                async function choose(winner){
                    choices.querySelectorAll('button').forEach(b=>b.disabled=true);
                    try{
                        await change('/rank','POST',{ids:winner===candidate?[candidate,peer]:[peer,candidate]});
                        if(!d.open)return;
                        if(winner===candidate)draft.high=mid;else draft.low=mid+1;
                        await draw();
                    }catch(error){message(error.message);choices.querySelectorAll('button').forEach(b=>b.disabled=false);}
                }
                choices.replaceChildren(btn(node(candidate).name,()=>choose(candidate)),btn(node(peer).name,()=>choose(peer)));
            }
            await draw();if(!await finished)return;
        }
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
        const groups=new Map();
        for(const row of rows){const canonical=execution.data?.nodes.find(n=>n.id===row.id);const parent=canonical?.parent_id||'';if(!groups.has(parent))groups.set(parent,[]);groups.get(parent).push(row.id);}
        const operations=[...groups.values()].filter(ids=>ids.length>1).map(ids=>({path:'/plan/rank',method:'POST',body:{ids,requestId:createId('importance')}}));
        if(operations.length)await window.TaskGraph.commit('importance comparisons',operations);
        await execution.refresh();
    }
    return {open,edit,work,recordImportance,async capture(parentId,onCreated){await open('project',parentId);await edit(null,'task','',onCreated);},context(){return {search,filter,sort,selected:[...selected]};},restoreContext(value){if(!value)return;search=value.search||'';filter=value.filter||'all';sort=value.sort||'sequence';selected=new Set(value.selected||[]);}};
})();
