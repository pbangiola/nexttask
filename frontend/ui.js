'use strict';

//functions for manipulating the DOM
function el(id) { return document.getElementById(id); }
function show(element) { element?.classList.remove('hidden'); }
function hide(element) { element?.classList.add('hidden'); }
function clearDynamic() { const c = el('dynamicContainer'); if (c) c.innerHTML = ''; return c; }
function hideStaticScreens() { ['modeSelect','workChoiceStep','timeConstraintInput','taskInput','taskCompare'].forEach(id => hide(el(id))); }

//mode selection functions
function showModeSelect() { hideStaticScreens(); clearDynamic(); show(el('modeSelect')); hide(el('stopWorkingBtn')); hide(el('startOverBtn')); }
function showWorkChoice() { hideStaticScreens(); clearDynamic(); show(el('workChoiceStep')); show(el('startOverBtn')); }
function showTimeConstraint() { hideStaticScreens(); clearDynamic(); show(el('timeConstraintInput')); show(el('startOverBtn')); el('availableTime').value = totalAvailableTimeMs ? Math.round(totalAvailableTimeMs/60000) : ''; el('endConstraint').value = endConstraint; }
function showTaskInput() { hideStaticScreens(); clearDynamic(); show(el('taskInput')); show(el('startOverBtn')); updateCapacityMessage(); }

//show and hide buttons

function resetAll() {
    clearInterval(timerInterval);
    sortRunId++;
    localStorage.removeItem(LOCAL_STATE_KEY);
    localStorage.removeItem('taskSorterSessionId');
    sessionId = createId('session');
    localStorage.setItem('taskSorterSessionId', sessionId);
    sortedTasks = [];
    activeTaskId = null;
    clearSessionTiming();
    endConstraint = '';
    currentSortNames = [];
    showModeSelect();
}

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
    hideStaticScreens(); hide(el('startOverBtn')); const container=clearDynamic(); const screen=document.createElement('div'); screen.id='timingGatewayScreen';
    const heading=document.createElement('h2'); heading.textContent='Do you want to set timings now?';
    const yes=document.createElement('button'); yes.textContent='Yes'; yes.onclick=()=>showSequentialTiming(0);
    const no=document.createElement('button'); no.textContent='No'; no.onclick=showDashboard;
    screen.append(heading,yes,no); container.appendChild(screen); saveLocal('timing-gateway');
}

function showSingleTaskEstimate(task){ hideStaticScreens(); hide(el('startOverBtn')); const container=clearDynamic(); const screen=document.createElement('div'); screen.id='deadlinePage'; const heading=document.createElement('h2'); heading.textContent=`Set a time for: ${task.name}`; const input=document.createElement('input'); input.type='number'; input.min='1'; input.max=String(MAX_TASK_MINUTES); const start=document.createElement('button'); start.textContent='Start Task'; start.onclick=()=>{const minutes=Number.parseInt(input.value,10);if(!Number.isFinite(minutes)||minutes<1||minutes>MAX_TASK_MINUTES){alert(`Enter a number from 1 to ${MAX_TASK_MINUTES}.`);return;}task.estimatedTimeMs=minutes*60000;showFocus(task);}; screen.append(heading,input,start); container.appendChild(screen); }

function prepareSortingDisplay(sortTask) {
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


function showFocus(task){
    if (hasHardStop() && Date.now() >= hardStopAtMs) { handleHardStop(); return; }
    startHardStopWatch();
    ensureTask(task); hideStaticScreens(); hide(el('startOverBtn')); show(el('stopWorkingBtn')); const container=clearDynamic(); const screen=document.createElement('div'); screen.id='focusScreen'; if(task.lastChanged===null) startTaskClock(task);
    const heading=document.createElement('h2'); heading.textContent=`Current Task: ${task.name}`; const timer=document.createElement('p'); timer.id='timer'; timer.style.fontSize='24px'; timer.style.fontWeight='bold';
    function renderTimer(){checkpointTask(task);const remaining=task.estimatedTimeMs-task.actualTimeMs;timer.style.color=remaining>=0?'green':'red';timer.textContent=remaining>=0?`${formatDuration(remaining)} remaining`:`${formatDuration(remaining)} overdue`;saveLocal('focus');}
    const done=document.createElement('button'); done.textContent='Done, Next!'; done.onclick=()=>{done.disabled=true;clearInterval(timerInterval);completeTask(task);activeTaskId=firstIncompleteTask()?.id||null;save('dashboard');beginWork();};
    const blocked=document.createElement('button'); blocked.textContent='Blocked'; blocked.onclick=()=>{clearInterval(timerInterval);pauseTaskClock(task);showBlockedFlow(task);};
    const add=document.createElement('button'); add.textContent='Add New Task'; add.onclick=()=>{clearInterval(timerInterval);checkpointTask(task);showAddTask(task);};
    screen.append(heading,timer,done,blocked,add); container.appendChild(screen); renderTimer(); clearInterval(timerInterval); timerInterval=setInterval(renderTimer,1000); save('focus');
}

function showBlockedFlow(blockedTask){
    hideStaticScreens(); hide(el('stopWorkingBtn')); const container=clearDynamic(); const screen=document.createElement('div'); screen.id='blockedTaskScreen';
    const heading=document.createElement('h2'); heading.textContent=`What is blocking “${blockedTask.name}”?`; const input=document.createElement('input'); input.placeholder='Blocking task';
    const confirm=document.createElement('button'); confirm.textContent='Add Blocker and Requeue Both'; confirm.onclick=()=>{const name=input.value.trim();if(!name){alert('Enter the blocking task.');return;}const blocker=createTask(name);const blockedIndex=sortedTasks.findIndex(task=>task.id===blockedTask.id);if(blockedIndex>=0)sortedTasks.splice(blockedIndex,1);blockedTask.status='pending';blockedTask.blockedByTaskId=null;blockedTask.lastChanged=null;sortedTasks.push(blocker,blockedTask);activeTaskId=firstIncompleteTask()?.id||null;save('dashboard');showDashboard();};
    const cancel=document.createElement('button'); cancel.textContent='Cancel and Continue Working'; cancel.onclick=()=>showFocus(blockedTask);
    screen.append(heading,input,confirm,cancel); container.appendChild(screen); saveLocal('focus');
}

function showAddTask(activeTask){
    hideStaticScreens(); const container=clearDynamic(); const screen=document.createElement('div'); screen.id='addTaskPage';
    const heading=document.createElement('h2'); heading.textContent='Add a Task'; const input=document.createElement('input'); input.placeholder='Task name';
    const choose=document.createElement('button'); choose.textContent='Choose Priority'; choose.onclick=()=>{const name=input.value.trim();if(!name){alert('Enter a task name.');return;}showTaskPlacement(createTask(name),activeTask);};
    const cancel=document.createElement('button'); cancel.textContent='Cancel'; cancel.onclick=()=>showFocus(activeTask); screen.append(heading,input,choose,cancel); container.appendChild(screen);
}

function showTaskPlacement(newTask,activeTask){
    const openTasks=incompleteTasks(); hideStaticScreens(); const container=clearDynamic(); const screen=document.createElement('div'); screen.id='taskPlacementScreen'; const heading=document.createElement('h2'); heading.textContent=`Where should “${newTask.name}” go?`; screen.appendChild(heading); const choices=document.createElement('div'); const activeIndex=sortedTasks.findIndex(task=>task.id===activeTask.id);
    function addChoice(label,insertIndex){const button=document.createElement('button');button.textContent=label;button.style.display='block';button.onclick=()=>{sortedTasks.splice(insertIndex,0,newTask);save('focus');showFocus(activeTask);};choices.appendChild(button);}
    addChoice('Do this next',Math.max(0,activeIndex+1)); openTasks.filter(task=>task.id!==activeTask.id).forEach(task=>{const index=sortedTasks.findIndex(item=>item.id===task.id);addChoice(`After “${task.name}”`,index+1);}); addChoice('Put it at the end',sortedTasks.length);
    const cancel=document.createElement('button');cancel.textContent='Cancel';cancel.onclick=()=>showFocus(activeTask);screen.append(choices,cancel);container.appendChild(screen);
}

function stopWorking(){clearInterval(timerInterval);const task=currentTask();if(task)pauseTaskClock(task);hide(el('stopWorkingBtn'));showStopChecklist();}

function showStopChecklist(){
    hideStaticScreens(); const container=clearDynamic(); const screen=document.createElement('div'); screen.id='stopChecklistScreen';
    const heading=document.createElement('h2'); heading.textContent='Did you finish any of these tasks?'; const note=document.createElement('p'); note.textContent='Check any tasks you completed, then end this work session.'; screen.append(heading,note);
    const checklist=document.createElement('div'); const checkboxes=[]; incompleteTasks().forEach(task=>{const label=document.createElement('label');label.style.display='block';const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.style.width='auto';checkbox.style.display='inline-block';checkbox.style.marginRight='8px';label.append(checkbox,document.createTextNode(task.name));checklist.appendChild(label);checkboxes.push({checkbox,task});});
    const finish=document.createElement('button'); finish.textContent='End Work Session'; finish.onclick=()=>{const now=Date.now();checkboxes.forEach(({checkbox,task})=>{if(checkbox.checked)completeTask(task,now);});activeTaskId=firstIncompleteTask()?.id||null;save('dashboard');if(firstIncompleteTask())showDashboard();else showCompletion();};
    const resume=document.createElement('button');resume.textContent='Keep Working';resume.onclick=()=>{const task=currentTask();if(task)showFocus(task);else showDashboard();};screen.append(checklist,finish,resume);container.appendChild(screen);saveLocal('stop-checklist');
}

async function resumeExistingList(){hideStaticScreens();const container=clearDynamic();container.textContent='Loading saved tasks…';try{await fetch(`${API_BASE_URL}/api/users/${encodeURIComponent(userId)}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:'{}'});await fetch(`${API_BASE_URL}/api/session/${encodeURIComponent(sessionId)}/tasks`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId,tasks:[],totalAvailableTimeMs:0,endConstraint:''})});const response=await fetch(`${API_BASE_URL}/api/users/${encodeURIComponent(userId)}/tasks/import`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId})});if(!response.ok)throw new Error(`Resume failed (${response.status})`);const data=await response.json();sortedTasks=(data.tasks||[]).map(row=>createTask(row.name,{id:row.id,estimatedTimeMs:row.estimated_ms,actualTimeMs:row.elapsed_ms,completed:false,status:row.status,created:row.created,started:row.started,lastChanged:null,blockedByTaskId:row.blocked_by_task_id}));activeTaskId=firstIncompleteTask()?.id||null;if(!sortedTasks.length){alert('No unfinished saved tasks were found.');showWorkChoice();return;}showDashboard();}catch(error){console.error(error);alert('The saved task list could not be loaded.');showWorkChoice();}}

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
            input.max = String(MAX_TASK_MINUTES);
            input.placeholder = `1-${MAX_TASK_MINUTES} minutes`;
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

        const maxWholeMinutes = Math.min(MAX_TASK_MINUTES, Math.floor(remainingMs / 60000));
        input.max = String(Math.max(1, maxWholeMinutes));
        input.placeholder = `1-${Math.max(1, maxWholeMinutes)} minutes`;
        next.disabled = maxWholeMinutes < 1;
    }

    next.onclick = () => {
        const minutes = Number.parseInt(input.value, 10);
        const remainingMs = remainingPlanningTimeMs();
        const maxWholeMinutes = remainingMs === null
            ? MAX_TASK_MINUTES
            : Math.min(MAX_TASK_MINUTES, Math.floor(remainingMs / 60000));

        if (!Number.isFinite(minutes) || minutes < 1 || minutes > maxWholeMinutes) {
            alert(`Enter a number from 1 to ${Math.max(1, maxWholeMinutes)}.`);
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

