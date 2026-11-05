'use strict';
window.Agenda = (() => {
    const base = () => '/plan';
    const request = (path,method='GET',body) => window.TaskGraph.request(base()+path,method,body);
    const button = (label,action,id) => {const b=document.createElement('button');b.textContent=label;b.onclick=action;if(id)b.id=id;return b;};
    const date = ms => new Date(ms).toLocaleString([], {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
    const localDate = ms => ms==null?'':new Date(ms-new Date(ms).getTimezoneOffset()*60000).toISOString().slice(0,16);
    let generation=0;
    function shell(title,id) {
        hideStaticScreens();hide(el('stopWorkingBtn'));hide(el('startOverBtn'));
        document.body.classList.toggle('planning',id==='calendarScreen'||id==='agendaScreen');
        const c=clearDynamic(),screen=document.createElement('section');screen.id=id;screen.className='plan-app';
        const h=document.createElement('h2');h.textContent=title;screen.appendChild(h);c.appendChild(screen);
        if(id==='calendarScreen'||id==='agendaScreen')window.AppNavigation?.go(id==='calendarScreen'?'calendar':'agenda');
        return screen;
    }
    function error(error) {
        const c=shell('Planning could not continue','agendaError');const p=document.createElement('p');p.textContent=error.message;c.append(p,button('Back to Work / Plan',showModeSelect));
    }
    function flatten(nodes,out=[]) {for(const node of nodes){out.push(node);flatten(node.children||[],out);}return out;}
    async function load() {
        if(window.TaskGraph.failed())throw new Error('Retry the pending save before planning or resuming.');
        await window.TaskGraph.flush();
        const [state,tree]=await Promise.all([request('/agenda'),window.TaskGraph.request(`/users/${encodeURIComponent(userId)}/nodes?tree=1`)]);
        const nodes=new Map(flatten(tree.nodes).map(row=>[row.id,row]));
        const names=row=>{const path=[row.name],seen=new Set([row.id]);let parent=nodes.get(row.parent_id);while(parent&&!seen.has(parent.id)){seen.add(parent.id);path.unshift(parent.name);parent=nodes.get(parent.parent_id);}return path.join(' / ');};
        for(const group of [state.items,state.agenda,state.backlog])for(const row of group)row.displayName=names(row);
        return {...state,nodes};
    }
    async function plan(options={}) {
        const run=++generation;
        try {
            shell('Plan','planLoading').append('Loading tasks…');
            const state=await load();if(run!==generation)return;
            const force=options?.rerank===true;
            const ranked=state.items.filter(row=>row.importance_rank!=null).sort((a,b)=>a.importance_rank-b.importance_rank).map(row=>({...row,name:row.displayName}));
            const unranked=state.items.filter(row=>row.importance_rank==null).map(row=>({...row,name:row.displayName}));
            const overdue=state.items.some(row=>row.due_at!=null&&row.due_at<Date.now());
            if(!state.items.length||!force&&!unranked.length&&!state.backlog.length&&!overdue)return showAgenda();
            const c=shell('Which task is more important?','planSorting');
            c.append('Rank your backlog and Agenda together.');
            const sort=++sortRunId,header=el('taskCompare').querySelector('h2');
            header.textContent='Which task is more important?';
            c.appendChild(button('Cancel',()=>{generation++;sortRunId++;hide(el('taskCompare'));header.textContent='Which task is more important?';showModeSelect();}));
            let rows=state.items.map(row=>({...row,name:row.displayName}));
            if(force)finishImportanceSort();
            beginImportanceSort(rows,'agenda');
            if(force)rows=await interactiveMergeSort(rows,sort);
            else{
                const added=await interactiveMergeSort(unranked,sort);
                if(run!==generation||sort!==sortRunId)return;
                rows=ranked.length&&added.length?await mergeWithChoices([...ranked],[...added],sort):[...ranked,...added];
            }
            if(run!==generation||sort!==sortRunId)return;
            hide(el('taskCompare'));
            const entries=rows.map(row=>({id:row.id,name:row.name,estimatedTimeMs:row.estimated_ms}));
            collectMissingEstimates(entries,async()=>{
                try {
                    for(const entry of entries){const row=rows.find(row=>row.id===entry.id);if(row.estimated_ms!==entry.estimatedTimeMs){await request(`/tasks/${encodeURIComponent(row.id)}`,'PUT',{remaining_ms:entry.estimatedTimeMs});state.revision=(await request('/agenda')).revision;row.estimated_ms=entry.estimatedTimeMs;}}
                    deadlines(rows,state);
                }catch(e){error(e);}
            },showModeSelect);
        }catch(e){error(e);}
    }
    function deadlines(rows,state) {
        const c=shell('Review deadlines','planDeadlines');
        const note=document.createElement('p');note.textContent='Confirm deadlines for the backlog and overdue tasks. Leave a date blank for no deadline. Your saved importance order is preserved.';c.appendChild(note);
        const fields=[];
        for(const [index,row] of rows.entries()) {
            const label=document.createElement('label');label.className='agenda-deadline';
            const caption=document.createElement('span');caption.textContent=`${index+1}. ${row.name}`;
            const input=document.createElement('input');input.type='datetime-local';input.value=localDate(row.due_at);input.setAttribute('aria-label',`Deadline for ${row.name}`);
            const clear=button('No deadline',()=>{input.value='';});
            label.append(caption,input,clear);c.appendChild(label);fields.push({row,input});
        }
        const requestId=createId('agenda_request');
        const save=button('Save Agenda',async()=>{
            const tasks=fields.map(({row,input})=>({id:row.id,dueAt:input.value?new Date(input.value).getTime():null}));
            if(tasks.some(row=>row.dueAt!==null&&(!Number.isFinite(row.dueAt)||row.dueAt<Date.now())))return alert('Choose a future deadline or no deadline for tasks with past deadlines.');
            save.disabled=true;
            try{await request('/agenda','PUT',{revision:state.revision,tasks,requestId});finishImportanceSort();await showAgenda();}catch(e){error(e);}
        },'saveAgenda');
        c.append(save,button('Manage tasks and projects',()=>window.NextPlan.open('inbox',null)),button('Cancel',showModeSelect));
    }
    function merged(state) {
        return [...state.agenda.filter(row=>row.start_at!=null).flatMap(row=>{const segments=JSON.parse(row.segments||'[]');return (segments.length?segments:[{start:row.start_at,end:row.end_at}]).map((segment,index)=>({...row,id:row.id+'-segment-'+index,start_at:segment.start,end_at:segment.end,name:row.displayName||row.name,kind:'task'}));}),...state.events.map(row=>({...row,kind:'event'}))].sort((a,b)=>a.start_at-b.start_at||(a.kind==='event'?-1:1));
    }
    function navigation(c,state) {
        const nav=document.createElement('nav');nav.className='plan-nav';nav.setAttribute('aria-label','Agenda views');
        nav.append(button('Agenda',showAgenda,'agendaView'),button('Calendar',()=>calendar(),'calendarView'),button('Export Calendar (.ics)',()=>{
            const url=URL.createObjectURL(new Blob([window.AgendaScheduler.ics(merged(state))],{type:'text/calendar;charset=utf-8'}));
            const a=document.createElement('a');a.href=url;a.download='nexttask-agenda.ics';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
        },'exportCalendar'),button('Replan',plan),button('Reorder importance',()=>plan({rerank:true})),button('Manage tasks and projects',()=>window.NextPlan.open('inbox',null)),button('Work / Plan',showModeSelect));c.appendChild(nav);
    }
    async function showAgenda() {
        try {
            const state=await load(),c=shell('Agenda','agendaScreen');navigation(c,state);
            if(state.agenda.some(row=>row.start_at==null))c.append('Some tasks need estimates, availability, or resolved prerequisites before they can be scheduled.');
            if(state.backlog.length){const p=document.createElement('p');p.textContent=`${state.backlog.length} task(s) in backlog. Replan to merge them into the Agenda.`;c.appendChild(p);}
            const list=document.createElement('ol');list.className='agenda-list';
            for(const row of merged(state)) {
                const item=document.createElement('li');
                const name=document.createElement('strong');name.textContent=row.name;
                const info=document.createElement('p');info.textContent=`${date(row.start_at)} – ${date(row.end_at)}`+(row.kind==='task'?` · Importance ${row.importance_rank}`:' · Calendar event');
                item.append(name,info);
                if(row.kind==='task'&&row.due_at!=null){const p=document.createElement('p');p.textContent=`Deadline: ${date(row.due_at)}`+(row.end_at>row.due_at?' · Deadline conflict: protected more important work or insufficient time.':'');if(row.end_at>row.due_at)p.className='agenda-conflict';item.appendChild(p);}
                if(row.kind==='event')item.appendChild(button('Delete event',async()=>{try{await request(`/calendar-events/${encodeURIComponent(row.id)}`,'DELETE');showAgenda();}catch(e){error(e);}}));
                list.appendChild(item);
            }
            if(!list.children.length)list.textContent='No scheduled tasks or events. Use Plan to build your Agenda.';
            c.appendChild(list);
            for(const row of state.agenda.filter(row=>row.start_at==null)){const p=document.createElement('p');p.textContent=`${row.displayName||row.name} · Importance ${row.importance_rank} · Unscheduled: review estimate, availability, or prerequisites.`;c.appendChild(p);}
            eventForm(c);
        }catch(e){error(e);}
    }
    function eventForm(c) {
        const form=document.createElement('form');form.id='calendarEventForm';
        const h=document.createElement('h3');h.textContent='Add a calendar event';form.appendChild(h);
        const fields={};
        for(const [key,text,type] of [['name','Event name','text'],['start','Starts','datetime-local'],['end','Ends','datetime-local']]) {
            const label=document.createElement('label');label.textContent=text;const input=document.createElement('input');input.type=type;input.required=true;input.setAttribute('aria-label',text);label.appendChild(input);form.appendChild(label);fields[key]=input;
        }
        const submit=button('Add event',()=>{});submit.type='submit';form.appendChild(submit);
        form.onsubmit=async event=>{event.preventDefault();submit.disabled=true;try{await request('/calendar-events','POST',{id:createId('event'),name:fields.name.value,startAt:new Date(fields.start.value).getTime(),endAt:new Date(fields.end.value).getTime()});await plan();}catch(e){error(e);}};
        c.appendChild(form);
    }
    async function calendar(anchor=new Date()) {
        try {
            const state=await load(),c=shell('Calendar','calendarScreen');navigation(c,state);
            const first=new Date(anchor);first.setHours(0,0,0,0);first.setDate(first.getDate()-first.getDay());
            const previous=new Date(first);previous.setDate(previous.getDate()-7);const next=new Date(first);next.setDate(next.getDate()+7);
            c.append(button('Previous week',()=>calendar(previous)),button('Today',()=>calendar(new Date())),button('Next week',()=>calendar(next)));
            const zone=document.createElement('p');zone.textContent=`Week of ${first.toLocaleDateString()} · ${Intl.DateTimeFormat().resolvedOptions().timeZone}`;c.appendChild(zone);
            const scroll=document.createElement('div');scroll.className='calendar-scroll';const grid=document.createElement('div');grid.className='calendar-week';scroll.appendChild(grid);
            const all=merged(state);
            for(let day=0;day<7;day++) {
                const start=new Date(first);start.setDate(start.getDate()+day);const end=new Date(start);end.setDate(end.getDate()+1);
                const column=document.createElement('section');const title=document.createElement('h3');title.textContent=start.toLocaleDateString([],{weekday:'short',month:'short',day:'numeric'});column.appendChild(title);
                const timeline=document.createElement('div');timeline.className='calendar-day';
                for(let hour=0;hour<24;hour++){const label=document.createElement('span');label.className='calendar-hour';label.style.top=`${hour*36}px`;label.textContent=`${String(hour).padStart(2,'0')}:00`;timeline.appendChild(label);}
                const lanes=[],blocks=[];
                for(const row of all.filter(row=>row.start_at<end.getTime()&&row.end_at>start.getTime())) {
                    const block=document.createElement('div');block.className=`calendar-block calendar-${row.kind}`;
                    const begins=new Date(Math.max(row.start_at,start.getTime())),finishes=new Date(Math.min(row.end_at,end.getTime()));
                    const minutes=begins.getHours()*60+begins.getMinutes();const endMinutes=row.end_at>=end.getTime()?1440:finishes.getHours()*60+finishes.getMinutes();
                    const top=minutes*.6,height=Math.max(24,(endMinutes-minutes)*.6);let lane=lanes.findIndex(bottom=>bottom<=top);if(lane<0)lane=lanes.length;lanes[lane]=top+height;blocks.push({block,lane});
                    block.style.top=`${top}px`;block.style.height=`${height}px`;
                    block.textContent=`${row.name} (${new Date(row.start_at).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})})`;block.title=`${row.name}: ${date(row.start_at)} – ${date(row.end_at)}`;timeline.appendChild(block);
                }
                for(const {block,lane} of blocks){block.style.left=`calc(30px + (100% - 32px) * ${lane}/${lanes.length})`;block.style.width=`calc((100% - 32px) / ${lanes.length})`;block.style.right='auto';}
                column.appendChild(timeline);grid.appendChild(column);
            }
            c.appendChild(scroll);if(innerWidth<700){const today=new Date();if(today>=first&&today<next)scroll.scrollLeft=today.getDay()*grid.children[0].getBoundingClientRect().width;}eventForm(c);
        }catch(e){error(e);}
    }
    function workTask(row,nodes) {
        const task=createTask(row.displayName||row.name,{id:row.id,estimatedTimeMs:row.estimated_ms,actualTimeMs:row.elapsed_ms,status:row.status,created:row.created,started:row.started,blockedByTaskId:row.blocked_by_task_id});
        const parents=[],names=[];let parent=nodes.get(row.parent_id);const seen=new Set();while(parent&&!seen.has(parent.id)){seen.add(parent.id);parents.unshift(parent.id);names.unshift(parent.name);parent=nodes.get(parent.parent_id);}
        return Object.assign(task,{canonicalName:row.name,parentId:row.parent_id,nodeType:row.node_type,nodePosition:row.position,independentlyActionable:row.independently_actionable===1,projectAncestorIds:parents,projectAncestorNames:names,projectPath:names.join(' › ')});
    }
    async function resume() {
        try {
            shell('Resume','resumeLoading').append('Loading saved work…');
            const state=await load();
            await window.PlanExecution.refresh();
            const executable=row=>row.executable;
            const backlog=state.backlog.filter(executable),ids=new Set(backlog.map(row=>row.id));
            const agenda=state.agenda.filter(row=>executable(row)&&!ids.has(row.id));
            const choices=window.AgendaScheduler.resume(backlog,agenda,hasHardStop()?hardStopAtMs:null);
            if(!choices.length){const c=shell('No executable tasks','resumeEmpty');c.append('Use Plan to add tasks or resolve blocked work.',button('Work / Plan',showModeSelect));return;}
            const start=async chosen=>{
                window.FocusDurability.newWork();window.currentWorkProjectContext=null;
                const queue=[chosen,...[...backlog,...agenda].filter(row=>row.id!==chosen.id)];
                sortedTasks=queue.map(row=>workTask(row,state.nodes));activeTaskId=chosen.id;
                await window.FocusDurability.prepare();await showFocus(sortedTasks[0]);
            };
            if(choices.length===1){await start(choices[0]);return;}
            const c=shell('Which task will you work on?','resumeChoiceScreen');
            for(const row of choices)c.appendChild(button(row.displayName||row.name,async()=>{try{for(const b of c.querySelectorAll('button'))b.disabled=true;await start(row);}catch(e){error(e);}}));
        }catch(e){error(e);}
    }
    if(window.taskSorterMode!=='guest'){
        document.getElementById('planBtn').onclick=plan;
        const saved=document.getElementById('savedPlanNav');if(saved)saved.onclick=plan;
        document.getElementById('agendaBtn').onclick=showAgenda;
        document.getElementById('calendarBtn').onclick=()=>calendar();
        window.WorkPlanner.resume=resume;
    }
    return {plan,show:showAgenda,calendar,resume,load};
})();
