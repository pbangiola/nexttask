'use strict';

//functions for manipulating the DOM
function el(id) { return document.getElementById(id); }
function show(element) { element?.classList.remove('hidden'); }
function hide(element) { element?.classList.add('hidden'); }
function clearDynamic() { window.FocusAlarm?.stop(); if (window.focusNormalTitle != null) { document.title = window.focusNormalTitle; window.focusNormalTitle = null; } document.body.classList.remove('focus-expanded'); clearInterval(timerInterval); const c = el('dynamicContainer'); if (c) c.innerHTML = ''; return c; }
function hideStaticScreens() { ['modeSelect','workChoiceStep','timeConstraintInput','taskInput','taskCompare'].forEach(id => hide(el(id))); }

//mode selection functions
function showModeSelect() { hideStaticScreens(); clearDynamic(); show(el('modeSelect')); hide(el('stopWorkingBtn')); hide(el('startOverBtn')); }
function showWorkChoice() { hideStaticScreens(); clearDynamic(); show(el('workChoiceStep')); show(el('startOverBtn')); }
function showTimeConstraint() { hideStaticScreens(); clearDynamic(); show(el('timeConstraintInput')); show(el('startOverBtn')); el('availableTime').value = totalAvailableTimeMs ? Math.round(totalAvailableTimeMs/60000) : ''; el('endConstraint').value = endConstraint; }
function showTaskInput() { hideStaticScreens(); clearDynamic(); show(el('taskInput')); show(el('startOverBtn')); updateCapacityMessage(); }

//show and hide buttons

function resetAll() { return window.FocusDurability.finish([], Date.now(), false, true); }

function restartCurrentStep() {
    clearInterval(timerInterval);

    if (!el('timeConstraintInput')?.classList.contains('hidden')) {
        el('availableTime').value = '';
        el('endConstraint').value = '';
        return;
    }

    if (!el('taskInput')?.classList.contains('hidden')) {
        el('tasks').value = '';
        el('skipSortCheckbox').checked = false;
        updateCapacityMessage();
        return;
    }

    if (!el('taskCompare')?.classList.contains('hidden')) {
        sortRunId++;
        if (window.currentExistingSort) {
            completeTask(window.currentExistingSort, Date.now());
            window.currentExistingSort = null;
            save('dashboard');
            window.resumeExistingList();
            return;
        }
        sortedTasks = [];
        activeTaskId = null;
        hide(el('taskCompare'));
        el('tasks').value = currentSortNames.join('\n');
        showTaskInput();
        return;
    }

    if (el('timingGatewayScreen')) {
        showTimingGateway();
        return;
    }

    if (el('timingEntryScreen')) {
        incompleteTasks().forEach(task => { task.estimatedTimeMs = 0; });
        showSequentialTiming(0);
    }
}

function showStartOverPrompt() {
    if (el('startOverModal')) return;

    const overlay = document.createElement('div');
    overlay.id = 'startOverModal';
    Object.assign(overlay.style, {
        position: 'fixed', inset: '0', backgroundColor: 'rgba(0,0,0,0.4)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: '1000'
    });

    const box = document.createElement('div');
    Object.assign(box.style, {
        backgroundColor: '#fff', padding: '20px', borderRadius: '8px',
        maxWidth: '320px', width: '85%', textAlign: 'center'
    });

    const message = document.createElement('p');
    message.textContent = 'What would you like to do?';
    message.style.fontWeight = 'bold';

    function modalButton(label, action, backgroundColor) {
        const button = document.createElement('button');
        button.textContent = label;
        Object.assign(button.style, { display: 'block', width: '100%', margin: '8px 0' });
        if (backgroundColor) button.style.backgroundColor = backgroundColor;
        button.onclick = () => { overlay.remove(); action(); };
        return button;
    }

    box.append(
        message,
        modalButton('Restart This Step', restartCurrentStep),
        modalButton('Restart From the Beginning', resetAll),
        modalButton('Cancel', () => {}, '#eceff1')
    );
    overlay.appendChild(box);
    document.body.appendChild(overlay);
}

function showTimingGateway() {
    // Kept only for restoring older saved sessions/imports. New task lists
    // require estimates at entry, so there is no now/later timing choice.
    showSequentialTiming(0);
}

function showSingleTaskEstimate(task){ hideStaticScreens(); hide(el('startOverBtn')); const container=clearDynamic(); const screen=document.createElement('div'); screen.id='deadlinePage'; const heading=document.createElement('h2'); heading.textContent=`Set a time for: ${task.name}`; const input=document.createElement('input'); input.type='number'; input.min='1'; input.placeholder='Minutes'; const start=document.createElement('button'); start.textContent='Start Task'; start.onclick=()=>{const minutes=Number.parseInt(input.value,10);if(!Number.isFinite(minutes)||minutes<1){alert('Enter a positive number of minutes.');return;}if(minutes>DECOMPOSITION_PROMPT_MINUTES&&!confirm(`“${task.name}” is estimated at ${minutes} minutes. Tasks over 20 minutes may be easier to manage if you split them. Choose OK to keep it whole.`))return;task.estimatedTimeMs=minutes*60000;showFocus(task);}; screen.append(heading,input,start); container.appendChild(screen); }

function prepareSortingDisplay(sortTask) {
    hideStaticScreens();
    hide(el('stopWorkingBtn'));
    clearDynamic();
    const compare = el('taskCompare');
    let taskHeading = el('sortTaskHeading');
    let sortTimer = el('sortTaskTimer');

    if (!taskHeading) {
        taskHeading = document.createElement('h2');
        taskHeading.id = 'sortTaskHeading';
        compare.insertBefore(taskHeading, compare.firstChild);
    }

    if (!sortTimer) {
        sortTimer = document.createElement('p');
        sortTimer.id = 'sortTaskTimer';
        sortTimer.style.fontSize = '24px';
        sortTimer.style.fontWeight = 'bold';
        taskHeading.insertAdjacentElement('afterend', sortTimer);
    }

    taskHeading.textContent = `Current Task: ${sortTask.name}`;

    function renderSortingTimer() {
        checkpointTask(sortTask);
        const remainingMs = sortTask.estimatedTimeMs - sortTask.actualTimeMs;
        sortTimer.style.color = remainingMs >= 0 ? 'green' : 'red';
        sortTimer.textContent = remainingMs >= 0
            ? `${formatDuration(remainingMs)} remaining`
            : `${formatDuration(remainingMs)} overdue`;
        saveLocal('sorting');
    }

    renderSortingTimer();
    clearInterval(timerInterval);
    timerInterval = setInterval(renderSortingTimer, 1_000);
}

function showFocus(task) { return window.FocusDurability.enter(task); }

function renderFocus(task){
    if (hasHardStop() && Date.now() >= hardStopAtMs) { handleHardStop(); return; }
    startHardStopWatch();
    ensureTask(task); hideStaticScreens(); hide(el('startOverBtn')); show(el('stopWorkingBtn')); const container=clearDynamic(); const screen=document.createElement('div'); screen.id='focusScreen';
    window.focusNormalTitle = document.title;
    screen.setAttribute('aria-label', 'Task focus');
    const heading=document.createElement('h2'); heading.textContent=task.name;
    const timer=document.createElement('p'); timer.id='timer'; timer.setAttribute('role','timer'); timer.setAttribute('aria-live','off');
    const label=document.createElement('p'); label.id='focusTimeLabel';
    const progress=document.createElement('progress'); progress.max=100; progress.setAttribute('aria-label','Proportion of task estimate remaining');
    const alarm=document.createElement('section'); alarm.id='focusAlarm'; alarm.hidden=true; alarm.setAttribute('aria-label','Task alarm');
    const message=document.createElement('p'); message.id='focusAlarmMessage'; message.setAttribute('role','status');
    function button(text, action, id) { const b=document.createElement('button'); b.textContent=text; b.onclick=action; if(id)b.id=id; return b; }
    alarm.append(message,button('Turn Off Alarm',()=>window.FocusAlarm.dismiss(),'alarmOff'),button('Snooze 5 Minutes',()=>window.FocusAlarm.snooze(),'alarmSnooze'));
    const done=button('Done, Next!',()=>{const action=window.FocusDurability.done(task);if(action)done.disabled=true;},'focusDone');
    const toolbar=document.createElement('div'); toolbar.className='focus-toolbar'; toolbar.setAttribute('role','group'); toolbar.setAttribute('aria-label','Work controls');
    toolbar.append(button('Blocked',()=>window.FocusDurability.pause(task,()=>showBlockedFlow(task))),button('Add New Task',()=>window.FocusDurability.pause(task,()=>showAddTask(task))),button('Pause / Session Controls',()=>el('stopWorkingBtn')?.click()));
    appendProjectToolbar(toolbar,task); appendParentSnooze(toolbar,true);
    const expanded=button('Expand Focus',()=>{const on=document.body.classList.toggle('focus-expanded');expanded.textContent=on?'Exit Expanded Focus':'Expand Focus';expanded.setAttribute('aria-pressed',String(on));}); expanded.setAttribute('aria-pressed','false'); toolbar.append(expanded);
    if(screen.requestFullscreen) toolbar.append(button('Fullscreen',async()=>{try { if(document.fullscreenElement)await document.exitFullscreen();else await screen.requestFullscreen(); }catch(_){audioStatus.textContent='Fullscreen is unavailable. Use Expand Focus.';}}));
    const sound=document.createElement('details'); const summary=document.createElement('summary'); summary.textContent='Sound Settings';
    const soundLabel=document.createElement('label'), enabled=document.createElement('input'); enabled.type='checkbox'; enabled.checked=window.FocusAlarm.settings().enabled; enabled.onchange=()=>window.FocusAlarm.configure({enabled:enabled.checked}); soundLabel.append(enabled,' Sound on');
    const volumeLabel=document.createElement('label'), volume=document.createElement('input'); volume.type='range';volume.min='0';volume.max='1';volume.step='.05';volume.value=window.FocusAlarm.settings().volume;volume.oninput=()=>window.FocusAlarm.configure({volume:Number(volume.value)});volumeLabel.append('Volume ',volume);
    const audioStatus=document.createElement('p');audioStatus.id='audioStatus';audioStatus.setAttribute('role','status');
    const limitation=document.createElement('p');limitation.textContent='Browsers may silence audio in the background or on a locked phone. The clock keeps running.';
    sound.append(summary,soundLabel,volumeLabel,button('Test Sound',()=>window.FocusAlarm.test()),audioStatus,limitation);
    screen.append(heading,timer,label,progress,alarm,done,toolbar,sound); container.appendChild(screen);
    function renderTimer(){checkpointTask(task);const remaining=task.estimatedTimeMs-task.actualTimeMs;const overtime=remaining<=0;timer.textContent=(overtime?'+':'')+formatDuration(remaining);label.textContent=overtime?'Over estimate':'Remaining';screen.classList.toggle('over-estimate',overtime);progress.value=Math.max(0,Math.min(100,remaining/task.estimatedTimeMs*100));document.title=`${overtime?'+':''}${formatDuration(remaining)} ${overtime?'over estimate':'remaining'} · ${task.name}`;window.FocusAlarm.check();saveLocal('focus');}
    renderTimer(); clearInterval(timerInterval); timerInterval=setInterval(renderTimer,1000);
}

function showBlockedFlow(blockedTask){
    hideStaticScreens(); hide(el('stopWorkingBtn')); const container=clearDynamic(); const screen=document.createElement('div'); screen.id='blockedTaskScreen';
    const heading=document.createElement('h2'); heading.textContent=`What is blocking “${blockedTask.name}”?`; const input=document.createElement('input'); input.placeholder='Blocking task';
    const confirm=document.createElement('button'); confirm.textContent='Add Blocker and Requeue Both'; confirm.onclick=()=>{
        const parsed=parseTaskEntries(input.value);
        if(parsed.invalid.length||parsed.entries.length!==1)return alert('Enter one blocking task.');
        const entry=parsed.entries[0], task=createTask(entry.name,entry);
        collectMissingEstimates([task],()=>window.FocusDurability.blocker(blockedTask,task),()=>showFocus(blockedTask));
    };
    const cancel=document.createElement('button'); cancel.textContent='Cancel and Continue Working'; cancel.onclick=()=>showFocus(blockedTask);
    screen.append(heading,input,confirm,cancel); container.appendChild(screen); saveLocal('focus');
}

function showAddTask(activeTask){
    hideStaticScreens(); const container=clearDynamic(); const screen=document.createElement('div'); screen.id='addTaskPage';
    const heading=document.createElement('h2'); heading.textContent='Add a Task'; const input=document.createElement('input'); input.placeholder='Task name; optional time, e.g. Call Sam, 10m';
    const choose=document.createElement('button'); choose.textContent='Choose Work Position'; choose.onclick=()=>{
        const parsed=parseTaskEntries(input.value);
        if(parsed.invalid.length||parsed.entries.length!==1)return alert('Enter one task.');
        const entry=parsed.entries[0], task=createTask(entry.name,entry);
        collectMissingEstimates([task],()=>showTaskPlacement(task,activeTask),()=>showFocus(activeTask));
    };
    const cancel=document.createElement('button'); cancel.textContent='Cancel'; cancel.onclick=()=>showFocus(activeTask); screen.append(heading,input,choose,cancel); container.appendChild(screen);
}

function showTaskPlacement(newTask,activeTask){
    const openTasks=incompleteTasks(); hideStaticScreens(); const container=clearDynamic(); const screen=document.createElement('div'); screen.id='taskPlacementScreen'; const heading=document.createElement('h2'); heading.textContent=`Where should “${newTask.name}” go?`; screen.appendChild(heading); const choices=document.createElement('div'); const activeIndex=sortedTasks.findIndex(task=>task.id===activeTask.id);
    function addChoice(label,insertIndex){const button=document.createElement('button');button.textContent=label;button.style.display='block';button.onclick=()=>{button.disabled=true;window.FocusDurability.add(newTask,insertIndex,activeTask);};choices.appendChild(button);}
    addChoice('Do this next',Math.max(0,activeIndex+1)); openTasks.filter(task=>task.id!==activeTask.id).forEach(task=>{const index=sortedTasks.findIndex(item=>item.id===task.id);addChoice(`After “${task.name}”`,index+1);}); addChoice('Put it at the end',sortedTasks.length);
    const cancel=document.createElement('button');cancel.textContent='Cancel';cancel.onclick=()=>showFocus(activeTask);screen.append(choices,cancel);container.appendChild(screen);
}

function stopWorking(){return window.FocusDurability.pause(currentTask(),()=>{hide(el('stopWorkingBtn'));showStopChecklist();});}

function showStopChecklist(){
    hideStaticScreens(); const container=clearDynamic(); const screen=document.createElement('div'); screen.id='stopChecklistScreen';
    const heading=document.createElement('h2'); heading.textContent='Did you finish any of these tasks?'; const note=document.createElement('p'); note.textContent='Check any tasks you completed, then end this work session.'; screen.append(heading,note);
    const checklist=document.createElement('div'); const checkboxes=[]; incompleteTasks().forEach(task=>{const label=document.createElement('label');label.style.display='block';const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.style.width='auto';checkbox.style.display='inline-block';checkbox.style.marginRight='8px';label.append(checkbox,document.createTextNode(task.name));checklist.appendChild(label);checkboxes.push({checkbox,task});});
    const finish=document.createElement('button'); finish.textContent='End Work Session'; finish.onclick=()=>{finish.disabled=true;window.FocusDurability.finish(checkboxes.filter(({checkbox})=>checkbox.checked).map(({task})=>task.id),Date.now());};
    const resume=document.createElement('button');resume.textContent='Keep Working';resume.onclick=()=>{const task=currentTask();if(task)showFocus(task);else showDashboard();};screen.append(checklist,finish,resume);container.appendChild(screen);saveLocal('stop-checklist');
}

function resumeExistingList() { return window.WorkPlanner.resume(); }

// Draft entries stay off the durable queue until all missing estimates are collected.
// Valid inline/saved estimates are skipped; cancellation never edits canonical rows.
function collectMissingEstimates(entries, onDone, onCancel) {
    const entry=entries.find(task=>Number(task.estimatedTimeMs||0)<=0);
    if(!entry)return onDone(entries);
    hideStaticScreens(); hide(el('stopWorkingBtn')); hide(el('startOverBtn'));
    const container=clearDynamic(), screen=document.createElement('div');
    screen.id='timingEntryScreen';
    const heading=document.createElement('h2');heading.textContent=`Estimate: ${entry.name}`;
    const input=document.createElement('input');input.type='number';input.min='0.01';input.step='any';input.placeholder='Minutes';
    const next=document.createElement('button');next.textContent='Save & Continue';
    next.onclick=()=>{
        const minutes=Number(input.value);
        if(!Number.isFinite(minutes)||minutes<=0)return alert('Enter a positive number of minutes.');
        entry.estimatedTimeMs=Math.round(minutes*60000);
        next.disabled=true;
        collectMissingEstimates(entries,onDone,onCancel);
    };
    const cancel=document.createElement('button');cancel.textContent='Cancel';cancel.onclick=()=>onCancel?.();
    screen.append(heading,input,next,cancel);container.appendChild(screen);
}

function showSequentialTiming(startIndex = 0) {
    clearInterval(timerInterval);

    const pending = incompleteTasks();
    const index = pending.findIndex((task, i) => i >= startIndex && task.estimatedTimeMs <= 0);
    if (index === -1) {
        showDashboard();
        return;
    }

    const task = pending[index];
    hideStaticScreens();
    show(el('startOverBtn'));

    const container = clearDynamic();
    const screen = document.createElement('div');
    screen.id = 'timingEntryScreen';

    const heading = document.createElement('h2');
    heading.textContent = `Current Task: ${task.name}`;

    const timerLabel = document.createElement('p');
    timerLabel.textContent = 'Time to work with:';
    timerLabel.style.marginBottom = '4px';

    const allocationTimer = document.createElement('p');
    allocationTimer.id = 'timer';
    allocationTimer.style.fontSize = '24px';
    allocationTimer.style.fontWeight = 'bold';
    allocationTimer.style.color = 'green';
    allocationTimer.style.marginTop = '0';

    const prompt = document.createElement('p');
    prompt.textContent = `Estimate time for task ${index + 1} of ${pending.length}.`;

    const input = document.createElement('input');
    input.type = 'number';
    input.min = '1';

    const next = document.createElement('button');
    next.textContent = index === pending.length - 1 ? 'Finish and View List' : 'Save & Next';

    function remainingPlanningTimeMs(now = Date.now()) {
        const sessionRemaining = sessionTimeRemainingMs(now);
        return sessionRemaining === null ? null : sessionRemaining - allocatedTimeMs();
    }

    function updatePlanningTimer() {
        const remainingMs = remainingPlanningTimeMs();

        if (remainingMs === null) {
            allocationTimer.textContent = 'No overall time limit';
            input.removeAttribute('max');
            input.placeholder = 'Minutes';
            next.disabled = false;
            return;
        }

        if (remainingMs <= 0) {
            clearInterval(timerInterval);
            saveLocal('dashboard');
            showDashboard();
            return;
        }

        allocationTimer.textContent = formatDuration(remainingMs);

        const maxWholeMinutes = Math.floor(remainingMs / 60_000);
        if (maxWholeMinutes < 1) {
            input.max = '0';
            input.placeholder = 'Less than 1 minute remains';
            input.disabled = true;
            next.disabled = true;
            return;
        }

        input.disabled = false;
        next.disabled = false;
        input.max = String(maxWholeMinutes);
        input.placeholder = `1-${maxWholeMinutes} minutes`;
    }

    next.onclick = () => {
        const minutes = Number.parseInt(input.value, 10);
        const remainingMs = remainingPlanningTimeMs();
        const maxWholeMinutes = remainingMs === null
            ? Number.POSITIVE_INFINITY
            : Math.floor(remainingMs / 60_000);

        if (!Number.isFinite(minutes) || minutes < 1 || minutes > maxWholeMinutes) {
            alert(remainingMs === null ? 'Enter a positive number of minutes.' : `Enter a number from 1 to ${Math.max(1, maxWholeMinutes)}.`);
            updatePlanningTimer();
            return;
        }

        task.estimatedTimeMs = minutes * 60000;
        saveLocal('timing-entry');
        showSequentialTiming(index + 1);
    };

    screen.append(heading, timerLabel, allocationTimer, prompt, input, next);
    container.appendChild(screen);

    updatePlanningTimer();
    timerInterval = setInterval(updatePlanningTimer, 1000);
    saveLocal('timing-entry');
}

function appendParentSnooze(screen,resume=false) {
    const parents=(window.ProjectQueue?.parents(sortedTasks)||[]).filter(parent=>!resume||currentTask()?.projectAncestorIds?.includes(parent.id));
    if(!parents.length)return;
    const controls=document.createElement('div');controls.className='parent-snooze-controls';
    for(const parent of parents){
        const button=document.createElement('button');button.textContent=`Snooze ${parent.name}`;
        button.dataset.snoozeParent=parent.id;button.disabled=!parent.canSnooze||!window.activeWorkSessionId;
        button.title='Move this parent and its remaining children one peer later in the Work queue. Importance and child order stay unchanged.';
        button.onclick=()=>{const action=window.FocusDurability.snooze(parent.id,resume);if(action)button.disabled=true;};controls.appendChild(button);
    }
    screen.appendChild(controls);
}
function appendProjectToolbar(screen, task = currentTask()) {
    const ctx=window.currentWorkProjectContext;
    if(!ctx||!screen||!task?.projectAncestorIds?.includes(ctx.id))return;
    const bar=document.createElement('div');bar.className='project-work-toolbar';
    bar.textContent=`${ctx.name} • Loading saved project timing…`;screen.appendChild(bar);
    // A project wall clock includes pauses/navigation and is not acknowledged
    // actual. Read the same backend aggregate used by the editor; do not create
    // a second project timer or block the existing task clock on this read.
    (async()=>{
        try {
            if(window.TaskGraph.pending())await window.TaskGraph.flush();
            const {node,progress}=await window.TaskGraph.request(`/users/${encodeURIComponent(userId)}/nodes/${encodeURIComponent(ctx.id)}`);
            if(!bar.isConnected||window.currentWorkProjectContext!==ctx)return;
            bar.dataset.estimatedMs=String(node.estimated_ms);bar.dataset.elapsedMs=String(node.elapsed_ms);
            const remaining=progress.remainingEstimateMs==null?'Unestimated':formatDuration(progress.remainingEstimateMs,true);
            bar.textContent=`${node.name} • planned ${formatDuration(node.estimated_ms,true)} • saved actual ${formatDuration(node.elapsed_ms,true)} • saved remaining ${remaining}`;
        } catch(_) { if(bar.isConnected)bar.textContent=`${ctx.name} • Saved project timing unavailable.`; }
    })();
}

function showDashboard(){hideStaticScreens();hide(el('stopWorkingBtn'));show(el('startOverBtn'));const container=clearDynamic(),screen=document.createElement('div');screen.id='dashboardScreen';const heading=document.createElement('h2');heading.textContent='Your Task List';screen.appendChild(heading);appendProjectToolbar(screen);appendParentSnooze(screen);const list=document.createElement('ol');let lastPath=null;sortedTasks.forEach(task=>{ensureTask(task);if(task.projectPath&&task.projectPath!==lastPath){const h=document.createElement('li');h.className='project-list-header';h.textContent=task.projectPath;list.appendChild(h);lastPath=task.projectPath;}const item=document.createElement('li'),estimate=task.estimatedTimeMs?` — ${Math.round(task.estimatedTimeMs/60000)} min`:'',state=task.completed?' ✓':task.status==='blocked'?' — blocked':'';item.textContent=`${task.name}${estimate}${state}`+(task.status==='blocked'?' — prerequisite must finish before Focus':'');list.appendChild(item);});screen.appendChild(list);const capacity=document.createElement('p');capacity.textContent=`Allocated: ${Math.round(allocatedTimeMs()/60000)} minutes`+(totalAvailableTimeMs?` of ${Math.round(totalAvailableTimeMs/60000)} available`:'');screen.appendChild(capacity);const b=document.createElement('button');b.textContent='Get to Work';b.onclick=beginWork;if(incompleteTasks().length&&!firstIncompleteTask()){b.disabled=true;const note=document.createElement('p');note.id='blockedOnlyState';note.textContent='No executable work: remaining tasks are blocked or not independently actionable. Finish the prerequisite or select a backlog containing it.';screen.appendChild(note);}const ex=document.createElement('button');ex.textContent='Download Task List';ex.onclick=exportCsv;screen.append(b,ex);container.appendChild(screen);save('dashboard');}

function showCompletion(){
    hideStaticScreens();hide(el('stopWorkingBtn'));show(el('startOverBtn'));const container=clearDynamic();const screen=document.createElement('div');screen.id='completionScreen';
    const heading=document.createElement('h2');heading.textContent='All Tasks Completed!';screen.appendChild(heading);
    const exportButton=document.createElement('button');exportButton.textContent='Download Task List';exportButton.onclick=exportCsv;screen.appendChild(exportButton);
    container.appendChild(screen);saveLocal('completion');
}

function showSessionEnded(){
    hideStaticScreens();hide(el('stopWorkingBtn'));show(el('startOverBtn'));const container=clearDynamic();const screen=document.createElement('div');screen.id='sessionEndedScreen';
    const heading=document.createElement('h2');heading.textContent='Work Session Ended';screen.appendChild(heading);
    if(endConstraint){const p=document.createElement('p');p.textContent=endConstraint;screen.appendChild(p);}
    const list=document.createElement('ol');incompleteTasks().forEach(task=>{const li=document.createElement('li');li.textContent=task.name;list.appendChild(li);});screen.appendChild(list);
    const exportButton=document.createElement('button');exportButton.textContent='Download Task List';exportButton.onclick=exportCsv;screen.appendChild(exportButton);
    container.appendChild(screen);saveLocal('session-ended');
}

function updateCapacityMessage() {
    let message = el('capacityMessage');
    if (!message) {
        message = document.createElement('p');
        message.id = 'capacityMessage';
        el('tasks')?.insertAdjacentElement('afterend', message);
    }
    if (!message) return;
    const names = parseTaskEntryText(el('tasks')?.value || '');
    const estimate = estimatedSortingTimeMs(names.length);
    message.textContent = names.length ? `Estimated sorting time: ${formatDuration(estimate)}` : '';
}
