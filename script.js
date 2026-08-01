// --- Core Application State & Session Engine ---
let sessionId = localStorage.getItem('taskSorterSessionId') || 'sess_' + Math.random().toString(36).substr(2, 9);
localStorage.setItem('taskSorterSessionId', sessionId);

let sortedTasks = [];           // Array of { name, estimatedTime, actualTimeMs }
let currentTaskIndex = 0;
let masterSchedule = [];        // Array of absolute target timestamp deadlines
let overallStartTimestamp = 0;  // True epoch timestamp when focus begins
let currentProjectContext = null;
let globalTimeoutId = null;
let timerInterval = null;

let taskExecutionState = {
    lastStarted: 0,
    accumulatedMs: 0,
    isPaused: false
};

// --- API Sync Layer ---
async function syncSessionToBackend() {
    try {
        await fetch(`/api/session/${sessionId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                state: {
                    sortedTasks,
                    currentTaskIndex,
                    masterSchedule,
                    overallStartTimestamp,
                    currentProjectContext,
                    taskExecutionState,
                    activeView: getActiveViewContext()
                }
            })
        });
    } catch (e) {
        console.warn("Backend sync offline, relying on local storage fallback.");
    }
}

async function logTaskCompletionToBackend(taskName, estimatedTime, actualTimeMs) {
    try {
        await fetch(`/api/session/${sessionId}/tasks/completed`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ taskName, estimatedTime, actualTimeMs })
        });
    } catch (e) {
        console.warn("Backend completion log fallback active.");
    }
}

function saveSession() {
    const sessionState = {
        sortedTasks,
        currentTaskIndex,
        masterSchedule,
        overallStartTimestamp,
        currentProjectContext,
        taskExecutionState,
        activeView: getActiveViewContext()
    };
    localStorage.setItem('taskSorterStateEngine', JSON.stringify(sessionState));
    syncSessionToBackend();
}

function loadSession() {
    const saved = localStorage.getItem('taskSorterStateEngine');
    if (!saved) {
        initInitialListeners();
        return;
    }
    try {
        const state = JSON.parse(saved);
        sortedTasks = state.sortedTasks || [];
        currentTaskIndex = state.currentTaskIndex || 0;
        masterSchedule = state.masterSchedule || [];
        overallStartTimestamp = state.overallStartTimestamp || 0;
        currentProjectContext = state.currentProjectContext || null;
        taskExecutionState = state.taskExecutionState || { lastStarted: 0, accumulatedMs: 0, isPaused: false };
        
        initInitialListeners();
        routeToStoredView(state.activeView);
    } catch (e) {
        initInitialListeners();
    }
}

function clearSession() {
    localStorage.removeItem('taskSorterStateEngine');
    fetch(`/api/session/${sessionId}`, { method: 'DELETE' }).catch(() => {});
    sortedTasks = [];
    currentTaskIndex = 0;
    masterSchedule = [];
    overallStartTimestamp = 0;
    currentProjectContext = null;
    taskExecutionState = { lastStarted: 0, accumulatedMs: 0, isPaused: false };
    if (timerInterval) clearInterval(timerInterval);
}

function getActiveViewContext() {
    if (document.getElementById('startChoiceScreen')) return 'start-choice';
    if (document.getElementById('focusScreen')) return 'focus';
    if (document.getElementById('deadlinePage')) return 'deadline';
    if (document.getElementById('addTaskPage')) return 'add-task';
    if (document.getElementById('completionScreen')) return 'completion';
    if (document.getElementById('projectBuilderPanel')) return 'project-wizard';
    if (document.getElementById('dashboardScreen')) return 'dashboard';
    return 'landing';
}

function routeToStoredView(view) {
    if (view === 'landing' || !view) return;

    document.getElementById('taskInputContainer').classList.add('hidden');

    if (view === 'start-choice') renderStartChoiceScreen();
    else if (view === 'focus') startFocusScreen();
    else if (view === 'deadline') startDeadlineSetting();
    else if (view === 'add-task') startAddTask();
    else if (view === 'completion') displayStatsScreen();
    else if (view === 'dashboard') displaySortedTasks();
    else if (view === 'project-wizard') resumeProjectWizard();
}

// --- App Entry & Landing Listeners ---
function initInitialListeners() {
    const submitBtn = document.getElementById('btnSubmitText');
    const fileInput = document.getElementById('csvFileInput');

    if (submitBtn) {
        submitBtn.onclick = () => {
            const input = document.getElementById('tasksTextarea').value.trim();
            if (!input) { alert('Please enter at least one task to get started.'); return; }
            const items = input.split('\n').map(t => t.trim()).filter(t => t);
            const skip = document.getElementById('skipSortCheckbox').checked;

            document.getElementById('taskInputContainer').classList.add('hidden');

            if (skip || items.length <= 1) {
                sortedTasks = items.map(name => ({ name, estimatedTime: 0, actualTimeMs: 0 }));
                currentTaskIndex = 0;
                runUpfrontTimingGateway();
            } else {
                startMergeSort(items);
            }
        };
    }

    if (fileInput) {
        fileInput.onchange = (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = function(evt) {
                const lines = evt.target.result.split('\n').map(l => l.trim()).filter(l => l);
                if (lines.length <= 1) { alert("That file looks empty or improperly formatted."); return; }
                const items = [];
                let processedCounter = 0;
                for(let i = 1; i < lines.length; i++) {
                    const parts = lines[i].match(/(".*?"|[^,]+)(?=\s*,|\s*$|\s*\n)/g);
                    if (!parts || parts.length < 2) continue;
                    const name = parts[0].replace(/^"|"$/g, '').trim();
                    const est = parseInt(parts[1], 10) || 0;
                    const actMs = (parseInt(parts[2], 10) || 0) * 60000;
                    items.push({ name, estimatedTime: est, actualTimeMs: actMs });
                    if (actMs > 0) processedCounter++;
                }
                if (items.length === 0) { alert("Couldn't find any valid task rows in that file."); return; }
                
                document.getElementById('taskInputContainer').classList.add('hidden');
                sortedTasks = items;
                currentTaskIndex = processedCounter;
                displaySortedTasks();
            };
            reader.readAsText(file);
        };
    }
}

// --- Item 22: Resume vs New List Choice Screen ---
function renderStartChoiceScreen() {
    const container = document.getElementById('dynamicContainer');
    container.innerHTML = `
        <div id="startChoiceScreen">
            <h2>Welcome Back!</h2>
            <p>How would you like to proceed?</p>
            <div class="choice-box-container">
                <div id="btnResumeList" class="forced-choice-box" style="background:#e8f5e9;">Resume Existing List</div>
                <div id="btnCreateNewList" class="forced-choice-box">Create a New Task List</div>
            </div>
        </div>
    `;

    document.getElementById('btnResumeList').onclick = () => {
        if (sortedTasks.length > 0) {
            startFocusScreen();
        } else {
            alert("No saved active list found. Let's create a new one!");
            showTaskInputPage();
        }
    };

    document.getElementById('btnCreateNewList').onclick = () => {
        clearSession();
        showTaskInputPage();
    };
    saveSession();
}

function showTaskInputPage() {
    document.getElementById('dynamicContainer').innerHTML = '';
    document.getElementById('taskInputContainer').classList.remove('hidden');
}

// --- Timing Configuration Upfront Gateway ---
function runUpfrontTimingGateway() {
    const container = document.getElementById('dynamicContainer');
    container.innerHTML = `
        <h2>Set Task Times Upfront?</h2>
        <p>Would you like to estimate task durations now, or jump straight to your list?</p>
        <div class="choice-box-container">
            <div id="gateYes" class="forced-choice-box">Set Times Now</div>
            <div id="gateNo" class="forced-choice-box">Skip and Open List</div>
        </div>
    `;
    document.getElementById('gateYes').onclick = () => runSequentialTimingLoop(0);
    document.getElementById('gateNo').onclick = () => displaySortedTasks();
    saveSession();
}

function runSequentialTimingLoop(index) {
    if (index >= sortedTasks.length) {
        displaySortedTasks();
        return;
    }
    const target = sortedTasks[index];
    const container = document.getElementById('dynamicContainer');
    container.innerHTML = `
        <h2>Task Time Estimate</h2>
        <p>Task ${index + 1} of ${sortedTasks.length}: <strong>${target.name}</strong></p>
        <input type="number" id="timingValInput" placeholder="Minutes (1-20)" min="1" max="20" style="margin-bottom:20px;">
        <div class="choice-box-container">
            <div id="btnCommitTime" class="forced-choice-box">Save Estimate</div>
        </div>
    `;

    document.getElementById('btnCommitTime').onclick = () => {
        const val = parseInt(document.getElementById('timingValInput').value, 10);
        if (isNaN(val) || val < 1 || val > 20) {
            alert("Please pick a time between 1 and 20 minutes.");
            return;
        }
        target.estimatedTime = val;

        if (val > 15) {
            initiateProjectWizard(index);
        } else {
            runSequentialTimingLoop(index + 1);
        }
    };
    saveSession();
}

// --- Recursive Multi-Tier Project Wizard ---
function initiateProjectWizard(parentIndex) {
    const parentName = sortedTasks[parentIndex].name;
    currentProjectContext = {
        parentIndex: parentIndex,
        parentName: parentName,
        subTasks: [],
        step: 'subtask-input'
    };
    renderProjectWizardScreen();
}

function resumeProjectWizard() {
    if (!currentProjectContext) { displaySortedTasks(); return; }
    renderProjectWizardScreen();
}

function renderProjectWizardScreen() {
    const container = document.getElementById('dynamicContainer');
    
    if (currentProjectContext.step === 'subtask-input') {
        container.innerHTML = `
            <div id="projectBuilderPanel">
                <h2>Project Detected (&gt;15m)</h2>
                <p>Task: <strong>${currentProjectContext.parentName}</strong></p>
                <div class="choice-box-container">
                    <div id="projKeepSingle" class="forced-choice-box">Keep as a single task</div>
                    <div id="projDeconstruct" class="forced-choice-box">Break into sub-tasks</div>
                </div>
            </div>
        `;
        document.getElementById('projKeepSingle').onclick = () => {
            const nextIdx = currentProjectContext.parentIndex + 1;
            currentProjectContext = null;
            runSequentialTimingLoop(nextIdx);
        };
        document.getElementById('projDeconstruct').onclick = () => {
            currentProjectContext.step = 'enter-subtasks';
            renderProjectWizardScreen();
        };
    } else if (currentProjectContext.step === 'enter-subtasks') {
        container.innerHTML = `
            <div id="projectBuilderPanel">
                <h2>Add Sub-tasks</h2>
                <p>Project: <strong>${currentProjectContext.parentName}</strong></p>
                <textarea id="subtaskTextarea" rows="6" placeholder="Enter sub-tasks (one per line)..."></textarea>
                <div class="choice-box-container">
                    <div id="subtaskSubmit" class="forced-choice-box">Add Sub-tasks</div>
                </div>
            </div>
        `;
        document.getElementById('subtaskSubmit').onclick = () => {
            const input = document.getElementById('subtaskTextarea').value.trim();
            if (!input) { alert("Please enter at least one sub-task."); return; }
            const items = input.split('\n').map(t => t.trim()).filter(t => t);
            
            currentProjectContext.subTaskObjects = items.map(n => ({ name: n, estimatedTime: 0, actualTimeMs: 0 }));
            currentProjectContext.subIndex = 0;
            currentProjectContext.step = 'timing-subtasks';
            renderProjectWizardScreen();
        };
    } else if (currentProjectContext.step === 'timing-subtasks') {
        const idx = currentProjectContext.subIndex;
        const subTasks = currentProjectContext.subTaskObjects;
        if (idx >= subTasks.length) {
            finalizeProjectFlattening(currentProjectContext.parentName);
            return;
        }
        const targetSub = subTasks[idx];
        container.innerHTML = `
            <div id="projectBuilderPanel">
                <h2>Estimate Sub-task Duration</h2>
                <p>Sub-task ${idx + 1} of ${subTasks.length}: <strong>${targetSub.name}</strong></p>
                <input type="number" id="subTimingInput" placeholder="Minutes (1-20)" min="1" max="20">
                <div class="choice-box-container">
                    <div id="subTimingSubmit" class="forced-choice-box">Save Sub-task Estimate</div>
                </div>
            </div>
        `;
        document.getElementById('subTimingSubmit').onclick = () => {
            const val = parseInt(document.getElementById('subTimingInput').value, 10);
            if (isNaN(val) || val < 1 || val > 20) { alert("Please enter a value between 1 and 20 minutes."); return; }
            targetSub.estimatedTime = val;
            
            if (val > 15) {
                targetSub.name = `${currentProjectContext.parentName}:${targetSub.name}`;
            }
            currentProjectContext.subIndex++;
            renderProjectWizardScreen();
        };
    }
    saveSession();
}

function finalizeProjectFlattening(finalProjectTitle) {
    const parentIndex = currentProjectContext.parentIndex;
    const flattenedChildren = currentProjectContext.subTaskObjects.map(s => {
        let coreName = s.name.startsWith(finalProjectTitle) ? s.name : `${finalProjectTitle}:${s.name}`;
        return { name: coreName, estimatedTime: s.estimatedTime, actualTimeMs: 0 };
    });
    
    sortedTasks.splice(parentIndex, 1, ...flattenedChildren);
    const resumeIndex = parentIndex + flattenedChildren.length;
    currentProjectContext = null;
    saveSession();
    runSequentialTimingLoop(resumeIndex);
}

// --- Master Dashboard ---
function displaySortedTasks() {
    document.getElementById('stopWorkingBtn').classList.add('hidden');
    const container = document.getElementById('dynamicContainer');
    container.innerHTML = `<div id="dashboardScreen"><h2>Your Plan</h2></div>`;
    const viewNode = document.getElementById('dashboardScreen');

    let totalQueueDuration = 0;
    sortedTasks.forEach(t => totalQueueDuration += t.estimatedTime);
    
    const durationLabel = document.createElement('h3');
    durationLabel.textContent = `Total Estimated Duration: ${totalQueueDuration} Minutes`;
    viewNode.appendChild(durationLabel);

    // 20-Minute Queue Limit Split Check
    if (totalQueueDuration > 20) {
        const splitModule = document.createElement('div');
        splitModule.style.padding = '12px';
        splitModule.style.background = '#fff3e0';
        splitModule.style.border = '1px solid #ffe0b2';
        splitModule.style.marginBottom = '15px';
        splitModule.innerHTML = `
            <p style="margin:0 0 8px 0; color:#e65100;"><strong>Long Session Warning:</strong> Total time exceeds 20 minutes.</p>
            <button id="btnTrigger20Split" style="background:#f57c00; color:#fff; border:none; padding:8px 12px; border-radius:4px; font-weight:bold; cursor:pointer;">Keep first 20 min and save rest for later</button>
        `;
        viewNode.appendChild(splitModule);
        document.getElementById('btnTrigger20Split').onclick = () => executeFocusSession20Split();
    }

    const masterListElement = document.createElement('ol');
    sortedTasks.forEach((task, idx) => {
        const li = document.createElement('li');
        li.style.marginBottom = '8px';

        const actMinutes = Math.round(task.actualTimeMs / 60000);
        if (idx < currentTaskIndex) {
            li.innerHTML = `<span style="color:#888; text-decoration:line-through;">${task.name} (Completed in ${actMinutes}m)</span>`;
        } else {
            li.innerHTML = `<strong>${task.name}</strong> ${task.estimatedTime > 0 ? `(${task.estimatedTime}m)` : ''}`;
        }
        masterListElement.appendChild(li);
    });
    viewNode.appendChild(masterListElement);

    const controlLayout = document.createElement('div');
    controlLayout.className = 'choice-box-container';

    if (currentTaskIndex < sortedTasks.length) {
        const actGo = document.createElement('div');
        actGo.className = 'forced-choice-box';
        actGo.style.background = '#e8f5e9';
        actGo.textContent = "Start Working";
        actGo.onclick = () => {
            if (masterSchedule.length === 0) {
                initializeAbsoluteScheduleTimeline();
            }
            startDeadlineSetting();
        };
        controlLayout.appendChild(actGo);
    }

    const actWipe = document.createElement('div');
    actWipe.className = 'forced-choice-box';
    actWipe.style.background = '#ffe0b2';
    actWipe.textContent = "Start Over";
    actWipe.onclick = () => {
        if (confirm("Reset everything and create a new list?")) {
            clearSession();
            showTaskInputPage();
        }
    };
    controlLayout.appendChild(actWipe);

    viewNode.appendChild(controlLayout);
    saveSession();
}

function executeFocusSession20Split() {
    let trackingAccumulator = 0;
    let splitIndex = -1;

    for (let i = 0; i < sortedTasks.length; i++) {
        trackingAccumulator += sortedTasks[i].estimatedTime;
        if (trackingAccumulator > 20) {
            splitIndex = i;
            break;
        }
    }

    if (splitIndex === -1) return;

    const keptTasks = sortedTasks.slice(0, splitIndex);
    const overflowTasks = sortedTasks.slice(splitIndex);

    fetch(`/api/session/${sessionId}/queue/prepend`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uncompletedTasks: overflowTasks })
    }).catch(() => {});

    sortedTasks = keptTasks;
    alert(`Trimmed session to 20 minutes. Saved ${overflowTasks.length} overflow tasks for your next session.`);
    masterSchedule = []; 
    displaySortedTasks();
}

function initializeAbsoluteScheduleTimeline() {
    overallStartTimestamp = Math.floor(Date.now() / 1000);
    let cumulativeSecondsOffset = 0;
    masterSchedule = [];
    
    sortedTasks.forEach(task => {
        cumulativeSecondsOffset += (task.estimatedTime * 60);
        masterSchedule.push(overallStartTimestamp + cumulativeSecondsOffset);
    });
}

function startDeadlineSetting() {
    document.getElementById('stopWorkingBtn').classList.remove('hidden');
    
    if (currentTaskIndex >= sortedTasks.length) {
        displayStatsScreen();
        return;
    }

    const target = sortedTasks[currentTaskIndex];
    if (target.estimatedTime > 0) {
        startFocusScreen();
        return;
    }

    const container = document.getElementById('dynamicContainer');
    container.innerHTML = `
        <div id="deadlinePage">
            <h2>Set Task Duration</h2>
            <p>Task: <strong>${target.name}</strong></p>
            <input type="number" id="checkpointDurationInput" placeholder="Minutes (1-20)">
            <div class="choice-box-container">
                <div id="btnStartFocus" class="forced-choice-box">Start Focus Timer</div>
            </div>
        </div>
    `;

    document.getElementById('btnStartFocus').onclick = () => {
        const val = parseInt(document.getElementById('checkpointDurationInput').value, 10);
        if (isNaN(val) || val < 1 || val > 20) { alert("Please pick a time between 1 and 20 minutes."); return; }
        
        target.estimatedTime = val;
        startFocusScreen();
    };
    saveSession();
}

// --- Active Focus Timer Screen ---
function startFocusScreen() {
    document.getElementById('stopWorkingBtn').classList.remove('hidden');

    const container = document.getElementById('dynamicContainer');
    container.innerHTML = `
        <div id="focusScreen">
            <h2>Current Focus</h2>
            <p id="focusTaskLabel" style="font-size:20px; margin-bottom:10px;"></p>
            <div id="timerClockDisplay" style="font-size:42px; font-weight:bold; margin:15px 0; font-family:monospace;">00:00</div>
            
            <div id="overtimeNotice" class="hidden" style="margin:15px 0; padding:10px; background:#fff3e0; border-radius:6px; color:#e65100;">
                You've passed your estimated time! Take your time, or tap <strong>Done</strong> when ready.
            </div>

            <div class="choice-box-container">
                <div id="btnDoneNext" class="forced-choice-box" style="background:#e8f5e9;">Done! Next Task</div>
                <div id="btnFocusAddTask" class="forced-choice-box">Add Task</div>
            </div>
        </div>
    `;

    const target = sortedTasks[currentTaskIndex];
    document.getElementById('focusTaskLabel').innerHTML = `Working on: <strong>${target.name}</strong>`;

    // Timestamp Fix (Item 20): Set lastStarted correctly
    const nowMs = Date.now();
    if (!taskExecutionState.isPaused || taskExecutionState.lastStarted === 0) {
        taskExecutionState.lastStarted = nowMs;
        taskExecutionState.isPaused = false;
    }

    function updateTimerTick() {
        const currentNowMs = Date.now();
        const currentElapsedMs = taskExecutionState.accumulatedMs + (currentNowMs - taskExecutionState.lastStarted);
        const targetMs = target.estimatedTime * 60000;
        const remainingMs = targetMs - currentElapsedMs;

        const absMs = Math.abs(remainingMs);
        const min = Math.floor(absMs / 60000);
        const sec = Math.floor((absMs % 60000) / 1000);
        const sign = remainingMs >= 0 ? "" : "-";

        document.getElementById('timerClockDisplay').textContent = `${sign}${min}:${sec < 10 ? '0' : ''}${sec}`;
        
        if (remainingMs < 0) {
            document.getElementById('timerClockDisplay').style.color = "#d32f2f";
            document.getElementById('overtimeNotice').classList.remove('hidden'); // Item 19: Non-blocking warning
        } else {
            document.getElementById('timerClockDisplay').style.color = "#2e7d32";
            document.getElementById('overtimeNotice').classList.add('hidden');
        }
    }

    updateTimerTick();
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(updateTimerTick, 1000);

    document.getElementById('btnDoneNext').onclick = async () => {
        clearInterval(timerInterval);
        const finalNowMs = Date.now();
        const finalTaskElapsedMs = taskExecutionState.accumulatedMs + (finalNowMs - taskExecutionState.lastStarted);

        target.actualTimeMs = finalTaskElapsedMs;

        // Reset execution state for next task
        taskExecutionState = { lastStarted: 0, accumulatedMs: 0, isPaused: false };

        await logTaskCompletionToBackend(target.name, target.estimatedTime, target.actualTimeMs);

        currentTaskIndex++;
        if (currentTaskIndex < sortedTasks.length) {
            startDeadlineSetting();
        } else {
            document.getElementById('stopWorkingBtn').classList.add('hidden');
            displayStatsScreen();
        }
    };

    document.getElementById('btnFocusAddTask').onclick = () => {
        clearInterval(timerInterval);
        // Pause timer cleanly
        taskExecutionState.accumulatedMs += (Date.now() - taskExecutionState.lastStarted);
        taskExecutionState.isPaused = true;
        startAddTask();
    };
    saveSession();
}

// --- Add Task Screen ---
function startAddTask() {
    document.getElementById('stopWorkingBtn').classList.add('hidden');
    const container = document.getElementById('dynamicContainer');
    container.innerHTML = `<div id="addTaskPage"><h2>Add a New Task</h2></div>`;
    const viewNode = document.getElementById('addTaskPage');

    const layout = document.createElement('div');
    layout.className = 'insertion-layout';

    const rightCol = document.createElement('div');
    rightCol.className = 'insertion-column';
    rightCol.innerHTML = `
        <p>What task would you like to add?</p>
        <textarea id="manualTaskNameInput" rows="3" placeholder="Enter task name..."></textarea>
        <p>Where should this task go?</p>
        <select id="manualSlotSelect" style="padding:8px; margin-bottom:15px;"></select>
        <div class="choice-box-container">
            <div id="btnCommitManualInsertion" class="forced-choice-box" style="background:#e3f2fd;">Insert & Resume</div>
        </div>
    `;

    layout.appendChild(rightCol);
    viewNode.appendChild(layout);

    const select = document.getElementById('manualSlotSelect');
    sortedTasks.forEach((t, idx) => {
        if (idx >= currentTaskIndex) {
            const opt = document.createElement('option');
            opt.value = idx + 1;
            opt.textContent = `Before: ${t.name}`;
            select.appendChild(opt);
        }
    });
    const endOpt = document.createElement('option');
    endOpt.value = sortedTasks.length + 1;
    endOpt.textContent = "At the end of the list";
    select.appendChild(endOpt);

    document.getElementById('btnCommitManualInsertion').onclick = () => {
        const text = document.getElementById('manualTaskNameInput').value.trim();
        const slot = parseInt(select.value, 10);

        if (!text) { alert("Please enter a task name."); return; }

        const freshObj = { name: text, estimatedTime: 0, actualTimeMs: 0 };
        sortedTasks.splice(slot - 1, 0, freshObj);
        
        startFocusScreen();
    };
    saveSession();
}

// --- Out of Order Completion Check Screen ---
document.getElementById('stopWorkingBtn').onclick = () => {
    if (timerInterval) clearInterval(timerInterval);
    document.getElementById('stopWorkingBtn').classList.add('hidden');
    handleStopWorking();
};

function handleStopWorking() {
    const container = document.getElementById('dynamicContainer');
    const uncompleted = sortedTasks.slice(currentTaskIndex);

    if (uncompleted.length === 0) {
        displayStatsScreen();
        return;
    }

    let checklistHTML = `
        <h2>Wrap Up Session</h2>
        <p>Did you finish any of these remaining tasks?</p>
        <form id="stopWorkingForm" style="text-align: left; margin: 20px 0;">
    `;

    uncompleted.forEach((task, idx) => {
        const globalIdx = currentTaskIndex + idx;
        checklistHTML += `
            <div style="margin-bottom: 10px;">
                <label>
                    <input type="checkbox" name="completedTask" value="${globalIdx}">
                    <strong>${task.name}</strong> (${task.estimatedTime}m est)
                </label>
            </div>
        `;
    });

    checklistHTML += `
        </form>
        <div class="choice-box-container">
            <div id="btnConfirmStop" class="forced-choice-box" style="background:#e8f5e9;">Save Completed & View Report</div>
        </div>
    `;

    container.innerHTML = checklistHTML;

    document.getElementById('btnConfirmStop').onclick = async () => {
        const checkboxes = document.querySelectorAll('input[name="completedTask"]:checked');
        const selectedIndices = Array.from(checkboxes).map(cb => parseInt(cb.value, 10));

        for (let idx of selectedIndices) {
            const task = sortedTasks[idx];
            task.actualTimeMs = task.estimatedTime * 60000;
            await logTaskCompletionToBackend(task.name, task.estimatedTime, task.actualTimeMs);
        }

        displayStatsScreen();
    };
}

// --- Final Session Summary Screen ---
function displayStatsScreen() {
    document.getElementById('stopWorkingBtn').classList.add('hidden');
    const container = document.getElementById('dynamicContainer');
    container.innerHTML = `<div id="completionScreen"><h2>All Done! Great Job!</h2></div>`;
    const viewNode = document.getElementById('completionScreen');

    const logsTitle = document.createElement('h3');
    logsTitle.textContent = "Summary of Completed Tasks:";
    viewNode.appendChild(logsTitle);

    const itemsUl = document.createElement('ul');
    sortedTasks.forEach(task => {
        if (task.actualTimeMs > 0) {
            const actMin = Math.round(task.actualTimeMs / 60000);
            const diff = task.estimatedTime - actMin;
            let statusStr = diff >= 0 ? `${diff} min ahead of estimate` : `${Math.abs(diff)} min over estimate`;
            
            const li = document.createElement('li');
            li.innerHTML = `<strong>${task.name}</strong> — Completed in ${actMin} min (${statusStr})`;
            itemsUl.appendChild(li);
        }
    });
    viewNode.appendChild(itemsUl);

    const actionBox = document.createElement('div');
    actionBox.className = 'choice-box-container';

    const btnRestartFresh = document.createElement('div');
    btnRestartFresh.className = 'forced-choice-box';
    btnRestartFresh.style.background = '#e8f5e9';
    btnRestartFresh.textContent = "Start Fresh Session";
    btnRestartFresh.onclick = () => {
        clearSession();
        showTaskInputPage();
    };

    actionBox.appendChild(btnRestartFresh);
    viewNode.appendChild(actionBox);
    saveSession();
}

// --- Interactive Merge Sorter Engines ---
function startMergeSort(array) {
    mergeSortInteractive(array).then(res => {
        sortedTasks = res.map(name => ({ name, estimatedTime: 0, actualTimeMs: 0 }));
        currentTaskIndex = 0;
        runUpfrontTimingGateway();
    });
}

async function mergeSortInteractive(array) {
    if (array.length <= 1) return array;
    const mid = Math.floor(array.length / 2);
    const left = await mergeSortInteractive(array.slice(0, mid));
    const right = await mergeSortInteractive(array.slice(mid));
    return mergeInteractive(left, right);
}

function mergeInteractive(left, right) {
    return new Promise(resolve => {
        const result = [];
        function handleStep() {
            if (!left.length && !right.length) {
                document.getElementById('taskCompare').classList.add('hidden');
                resolve(result);
                return;
            }
            if (!left.length) { result.push(...right); document.getElementById('taskCompare').classList.add('hidden'); resolve(result); return; }
            if (!right.length) { result.push(...left); document.getElementById('taskCompare').classList.add('hidden'); resolve(result); return; }

            document.getElementById('taskCompare').classList.remove('hidden');
            document.getElementById('task1').textContent = left[0];
            document.getElementById('task2').textContent = right[0];

            document.getElementById('task1').onclick = () => { result.push(left.shift()); handleStep(); };
            document.getElementById('task2').onclick = () => { result.push(right.shift()); handleStep(); };
        }
        handleStep();
    });
}

// Initialization Entrypoint
window.addEventListener('DOMContentLoaded', loadSession);
