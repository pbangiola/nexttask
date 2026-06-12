// --- Core Application Memory State Variables ---
let sortedTasks = [];         // Flattened tasks array: { name, estimatedTime, actualTime }
let currentTaskIndex = 0;
let masterSchedule = [];      // Array of absolute target timestamp deadlines matching task indices
let overallStartTimestamp = 0; // True epoch timestamp when focus workflow begins
let currentProjectContext = null; // Wizard state payload for building nested tasks
let globalTimeoutId = null;   // Tracker identifier for 30s screen drop timeouts
let timerInterval = null;     // Focus countdown tick reference

// --- Session Persistence Handlers ---
function saveSession() {
    const sessionState = {
        sortedTasks,
        currentTaskIndex,
        masterSchedule,
        overallStartTimestamp,
        currentProjectContext,
        activeView: getActiveViewContext()
    };
    localStorage.setItem('taskSorterStateEngine', JSON.stringify(sessionState));
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
        
        initInitialListeners();
        routeToStoredView(state.activeView);
    } catch (e) {
        console.error("Session parse violation:", e);
        initInitialListeners();
    }
}

function clearSession() {
    localStorage.removeItem('taskSorterStateEngine');
    sortedTasks = [];
    currentTaskIndex = 0;
    masterSchedule = [];
    overallStartTimestamp = 0;
    currentProjectContext = null;
    clearGlobalTimeout();
    if (timerInterval) clearInterval(timerInterval);
}

function getActiveViewContext() {
    if (document.getElementById('focusScreen')) return 'focus';
    if (document.getElementById('deadlinePage')) return 'deadline';
    if (document.getElementById('addTaskPage')) return 'add-task';
    if (document.getElementById('completionScreen')) return 'completion';
    if (document.getElementById('projectBuilderPanel')) return 'project-wizard';
    if (document.getElementById('projectSummaryPanel')) return 'project-summary';
    if (document.getElementById('dashboardScreen')) return 'dashboard';
    return 'landing';
}

function routeToStoredView(view) {
    if (view === 'landing') {
        // Stay on default HTML layout input state
        return;
    }
    // For any advanced app state, clear out the static landing fields
    document.getElementById('taskInputContainer').classList.add('hidden');

    if (view === 'focus') startFocusScreen();
    else if (view === 'deadline') startDeadlineSetting();
    else if (view === 'add-task') startAddTask();
    else if (view === 'completion') displayStatsScreen();
    else if (view === 'dashboard') displaySortedTasks();
    else if (view === 'project-wizard') resumeProjectWizard();
}

function clearGlobalTimeout() {
    if (globalTimeoutId) {
        clearTimeout(globalTimeoutId);
        globalTimeoutId = null;
    }
}

function startViewTimeout(callback, durationMs = 30000) {
    clearGlobalTimeout();
    globalTimeoutId = setTimeout(callback, durationMs);
}

// --- Wire Up Landing Form View Elements ---
function initInitialListeners() {
    const submitBtn = document.getElementById('btnSubmitText');
    const fileInput = document.getElementById('csvFileInput');

    if (submitBtn) {
        submitBtn.onclick = () => {
            const input = document.getElementById('tasksTextarea').value.trim();
            if (!input) { alert('Task inputs cannot evaluate blank.'); return; }
            const items = input.split('\n').map(t => t.trim()).filter(t => t);
            const skip = document.getElementById('skipSortCheckbox').checked;

            document.getElementById('taskInputContainer').classList.add('hidden');

            if (skip || items.length <= 1) {
                sortedTasks = items.map(name => ({ name, estimatedTime: 0, actualTime: 0 }));
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
                if (lines.length <= 1) { alert("Corrupt CSV header map."); return; }
                const items = [];
                let processedCounter = 0;
                for(let i = 1; i < lines.length; i++) {
                    const parts = lines[i].match(/(".*?"|[^,]+)(?=\s*,|\s*$|\s*\n)/g);
                    if (!parts || parts.length < 3) continue;
                    const name = parts[0].replace(/^"|"$/g, '').trim();
                    const est = parseInt(parts[1], 10) || 0;
                    const act = parseInt(parts[2], 10) || 0;
                    items.push({ name, estimatedTime: est, actualTime: act });
                    if (act > 0) processedCounter++;
                }
                if (items.length === 0) { alert("Zero validation matches extracted."); return; }
                
                document.getElementById('taskInputContainer').classList.add('hidden');
                sortedTasks = items;
                currentTaskIndex = processedCounter;
                displaySortedTasks();
            };
            reader.readAsText(file);
        };
    }
}

// Timing Profile Gateway Option Check
function runUpfrontTimingGateway() {
    clearGlobalTimeout();
    const container = document.getElementById('dynamicContainer');
    container.innerHTML = `
        <h2>Configure Task Durations Upfront?</h2>
        <div class="choice-box-container">
            <div id="gateYes" class="forced-choice-box">Yes (Set Timings Now)</div>
            <div id="gateNo" class="forced-choice-box">No (Skip and Open List)</div>
        </div>
    `;
    document.getElementById('gateYes').onclick = () => runSequentialTimingLoop(0);
    document.getElementById('gateNo').onclick = () => displaySortedTasks();
    saveSession();
}

// Main Upfront Step 3b Configuration Loop Engine
function runSequentialTimingLoop(index) {
    clearGlobalTimeout();
    if (index >= sortedTasks.length) {
        displaySortedTasks();
        return;
    }
    const target = sortedTasks[index];
    const container = document.getElementById('dynamicContainer');
    container.innerHTML = `
        <div class="timeout-banner">Auto-submitting 10m default fallback in 30 seconds...</div>
        <h2>Configure Estimation Window</h2>
        <p>Task ${index + 1} of ${sortedTasks.length}: <strong>${target.name}</strong></p>
        <input type="number" id="timingValInput" placeholder="Minutes (1-120)" min="1" max="120" style="margin-bottom:20px;">
        <div class="choice-box-container">
            <div id="btnCommitTime" class="forced-choice-box">Commit Estimate</div>
        </div>
    `;

    startViewTimeout(() => {
        target.estimatedTime = 10;
        runSequentialTimingLoop(index + 1);
    });

    document.getElementById('btnCommitTime').onclick = () => {
        const val = parseInt(document.getElementById('timingValInput').value, 10);
        if (isNaN(val) || val < 1 || val > 120) {
            alert("Please input values bounded safely between 1 and 120 minutes.");
            return;
        }
        clearGlobalTimeout();
        target.estimatedTime = val;

        if (val > 15) {
            initiateProjectWizard(index);
        } else {
            runSequentialTimingLoop(index + 1);
        }
    };
    saveSession();
}

// --- Recursive Project Compilation Wizard ---
function initiateProjectWizard(parentIndex) {
    currentProjectContext = {
        parentIndex: parentIndex,
        parentName: sortedTasks[parentIndex].name,
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
    clearGlobalTimeout();
    const container = document.getElementById('dynamicContainer');
    
    if (currentProjectContext.step === 'subtask-input') {
        container.innerHTML = `
            <div id="projectBuilderPanel">
                <h2>Project Detected (&gt;15m)</h2>
                <p>Item: <strong>${currentProjectContext.parentName}</strong></p>
                <div class="choice-box-container">
                    <div id="projKeepSingle" class="forced-choice-box">Keep as single long task</div>
                    <div id="projDeconstruct" class="forced-choice-box">Create a Project Structure</div>
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
                <h2>Define Sub-tasks for Project</h2>
                <p>Parent Context: <strong>${currentProjectContext.parentName}</strong></p>
                <textarea id="subtaskTextarea" rows="6" placeholder="Enter sub-tasks (one per line)... No file uploads allowed."></textarea>
                <div class="checkbox-container">
                    <label><input type="checkbox" id="subtaskSkipSort"> Skip sub-sorting trees</label>
                </div>
                <div class="choice-box-container">
                    <div id="subtaskSubmit" class="forced-choice-box">Submit and Map Sub-queue</div>
                </div>
            </div>
        `;
        document.getElementById('subtaskSubmit').onclick = () => {
            const input = document.getElementById('subtaskTextarea').value.trim();
            if (!input) { alert("Sub-projects must declare active child items."); return; }
            const items = input.split('\n').map(t => t.trim()).filter(t => t);
            const skip = document.getElementById('subtaskSkipSort').checked;
            
            currentProjectContext.rawItems = items;
            currentProjectContext.skipSort = skip;
            currentProjectContext.step = 'sorting-subtasks';
            renderProjectWizardScreen();
        };
    } else if (currentProjectContext.step === 'sorting-subtasks') {
        const items = currentProjectContext.rawItems;
        if (currentProjectContext.skipSort || items.length <= 1) {
            currentProjectContext.sortedNames = items;
            currentProjectContext.subTaskObjects = items.map(n => ({ name: n, estimatedTime: 0, actualTime: 0 }));
            currentProjectContext.subIndex = 0;
            currentProjectContext.step = 'timing-subtasks';
            renderProjectWizardScreen();
        } else {
            mergeSortInteractive(items).then(res => {
                currentProjectContext.sortedNames = res;
                currentProjectContext.subTaskObjects = res.map(n => ({ name: n, estimatedTime: 0, actualTime: 0 }));
                currentProjectContext.subIndex = 0;
                currentProjectContext.step = 'timing-subtasks';
                renderProjectWizardScreen();
            });
        }
    } else if (currentProjectContext.step === 'timing-subtasks') {
        const idx = currentProjectContext.subIndex;
        const subTasks = currentProjectContext.subTaskObjects;
        if (idx >= subTasks.length) {
            currentProjectContext.step = 'project-confirmation';
            renderProjectWizardScreen();
            return;
        }
        const targetSub = subTasks[idx];
        container.innerHTML = `
            <div id="projectBuilderPanel">
                <div class="timeout-banner">Auto-submitting 10m default fallback in 30 seconds...</div>
                <h2>Estimate Sub-task Profile</h2>
                <p>Sub-task ${idx + 1} of ${subTasks.length}: <strong>${targetSub.name}</strong></p>
                <input type="number" id="subTimingInput" placeholder="Minutes (1-120)" min="1" max="120">
                <div class="choice-box-container">
                    <div id="subTimingSubmit" class="forced-choice-box">Commit Sub-estimate</div>
                </div>
            </div>
        `;
        startViewTimeout(() => {
            targetSub.estimatedTime = 10;
            currentProjectContext.subIndex++;
            renderProjectWizardScreen();
        });
        document.getElementById('subTimingSubmit').onclick = () => {
            const val = parseInt(document.getElementById('subTimingInput').value, 10);
            if (isNaN(val) || val < 1 || val > 120) { alert("Values must sit between 1 and 120 minutes."); return; }
            clearGlobalTimeout();
            targetSub.estimatedTime = val;
            
            if (val > 15) {
                alert(`Sub-task exceeds 15m. Nesting child sub-tier inside: ${targetSub.name}`);
                targetSub.name = `${currentProjectContext.parentName}:${targetSub.name}`;
            }
            currentProjectContext.subIndex++;
            renderProjectWizardScreen();
        };
    } else if (currentProjectContext.step === 'project-confirmation') {
        let cumulativeSum = 0;
        let listBuffer = "";
        currentProjectContext.subTaskObjects.forEach(s => {
            cumulativeSum += s.estimatedTime;
            listBuffer += `<li>${currentProjectContext.parentName}:${s.name} (${s.estimatedTime}m)</li>`;
        });
        container.innerHTML = `
            <div id="projectBuilderPanel">
                <h2>Verify Compiled Project Properties</h2>
                <p>Base Anchor Target Identifier: <strong>${currentProjectContext.parentName}</strong></p>
                <p>Aggregated Total Payload: <strong>${cumulativeSum} Estimated Minutes</strong></p>
                <ul>${listBuffer}</ul>
                <input type="text" id="projectRenameInput" value="${currentProjectContext.parentName}" style="margin-bottom:25px;">
                <div class="choice-box-container">
                    <div id="btnConfirmAndDownload" class="forced-choice-box">Download Structural Tree CSV</div>
                    <div id="btnConfirmSkipDownload" class="forced-choice-box">Inject into Queue and Return</div>
                </div>
            </div>
        `;
        document.getElementById('btnConfirmAndDownload').onclick = () => {
            const finalTitle = document.getElementById('projectRenameInput').value.trim() || currentProjectContext.parentName;
            executeIsolatedProjectCSVDownload(finalTitle, currentProjectContext.subTaskObjects);
            finalizeProjectFlattening(finalTitle);
        };
        document.getElementById('btnConfirmSkipDownload').onclick = () => {
            const finalTitle = document.getElementById('projectRenameInput').value.trim() || currentProjectContext.parentName;
            finalizeProjectFlattening(finalTitle);
        };
    }
    saveSession();
}

function executeIsolatedProjectCSVDownload(projectName, subtasks) {
    let csv = "Subtask Target,Estimated Time (Min),Actual Time (Min)\n";
    subtasks.forEach(s => {
        csv += `"${projectName}:${s.name}",${s.estimatedTime},0\n`;
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${projectName.replace(/[^a-z0-9]/gi, '_')}_structure.csv`;
    link.click();
}

function finalizeProjectFlattening(finalProjectTitle) {
    const parentIndex = currentProjectContext.parentIndex;
    const flattenedChildren = currentProjectContext.subTaskObjects.map(s => {
        let coreName = s.name;
        if (!coreName.startsWith(finalProjectTitle)) {
            coreName = `${finalProjectTitle}:${coreName}`;
        }
        return { name: coreName, estimatedTime: s.estimatedTime, actualTime: 0 };
    });
    
    sortedTasks.splice(parentIndex, 1, ...flattenedChildren);
    const resumeIndex = parentIndex + flattenedChildren.length;
    currentProjectContext = null;
    saveSession();
    runSequentialTimingLoop(resumeIndex);
}

// --- Step 4: Master Dashboard Operations Pane ---
function displaySortedTasks() {
    clearGlobalTimeout();
    document.getElementById('stopWorkingBtn').classList.add('hidden');
    const container = document.getElementById('dynamicContainer');
    container.innerHTML = `<div id="dashboardScreen"><h2>Master Dashboard & Strategy Map</h2></div>`;
    const viewNode = document.getElementById('dashboardScreen');

    let totalQueueDuration = 0;
    sortedTasks.forEach(t => totalQueueDuration += t.estimatedTime);
    
    const durationLabel = document.createElement('h3');
    durationLabel.textContent = `Estimated Total Time: ${totalQueueDuration} Minutes`;
    viewNode.appendChild(durationLabel);

    // 120-Minute Split Interceptor Trigger Box
    if (totalQueueDuration > 120) {
        const splitModule = document.createElement('div');
        splitModule.style.padding = '15px';
        splitModule.style.background = '#e1f5fe';
        splitModule.style.border = '1px solid #03a9f4';
        splitModule.style.marginBottom = '20px';
        splitModule.innerHTML = `
            <p style="color:#01579b; margin:0 0 10px 0;"><strong>Optimization Boundary:</strong> Total combined load breaks 120m cap threshold parameters.</p>
            <button id="btnTrigger120Split" style="background:#0288d1; color:#fff; font-weight:bold;">Isolate and Export Overlap Contingency Lists</button>
        `;
        viewNode.appendChild(splitModule);
        document.getElementById('btnTrigger120Split').onclick = () => executeFocusSession120Split();
    }

    const masterListElement = document.createElement('ol');
    const processedProjectRoots = new Set();

    sortedTasks.forEach((task, idx) => {
        const li = document.createElement('li');
        li.style.styleFloat = 'none';
        li.style.marginBottom = '10px';

        if (task.name.includes(':')) {
            const rootParent = task.name.split(':')[0];
            if (processedProjectRoots.has(rootParent)) return;
            processedProjectRoots.add(rootParent);

            if (idx < currentTaskIndex) {
                li.innerHTML = `<span style="color:gray; text-decoration:line-through;">Project Group: ${rootParent} (Completed)</span>`;
            } else {
                li.innerHTML = `Project Profile Group: <strong class="hyperlink-style" onclick="renderProjectSummaryPane('${rootParent}')">${rootParent}</strong> <em>[Open Subtask View]</em>`;
            }
        } else {
            if (idx < currentTaskIndex) {
                li.innerHTML = `<span style="color:gray; text-decoration:line-through;">${task.name} (Done | Est: ${task.estimatedTime}m, Act: ${task.actualTime}m)</span>`;
            } else {
                li.innerHTML = `<strong>${task.name}</strong> ${task.estimatedTime > 0 ? `(${task.estimatedTime}m)` : '(Unassigned)'}`;
            }
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
        actGo.textContent = (masterSchedule.length > 0) ? "Resume Absolute Work Session" : "Get to Work (Lock Schedule)";
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
    actWipe.textContent = "Reset and Wipe State Storage";
    actWipe.onclick = () => {
        if (confirm("Permanently wipe operational local storage memory?")) {
            clearSession();
            window.location.reload();
        }
    };
    controlLayout.appendChild(actWipe);

    viewNode.appendChild(controlLayout);
    saveSession();
}

function executeFocusSession120Split() {
    let trackingAccumulator = 0;
    let splitIndex = -1;

    for (let i = 0; i < sortedTasks.length; i++) {
        trackingAccumulator += sortedTasks[i].estimatedTime;
        if (trackingAccumulator > 120) {
            splitIndex = i;
            break;
        }
    }

    if (splitIndex === -1) return;

    const keptTasks = sortedTasks.slice(0, splitIndex);
    const droppedTasks = sortedTasks.slice(splitIndex);

    let csv = "Task Name,Estimated Time (Min),Actual Time (Min)\n";
    droppedTasks.forEach(t => {
        csv += `"${t.name.replace(/"/g, '""')}",${t.estimatedTime},${t.actualTime}\n`;
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = "session_continuation_120m_overflow.csv";
    link.click();

    sortedTasks = keptTasks;
    if (currentTaskIndex >= sortedTasks.length) {
        currentTaskIndex = Math.max(0, sortedTasks.length - 1);
    }
    
    alert(`Trimmed active configuration. Exported ${droppedTasks.length} tasks down to overflow manifestation CSV.`);
    masterSchedule = []; 
    displaySortedTasks();
}

// Exploded Project Hierarchy Dashboard Extension Router
function renderProjectSummaryPane(parentName) {
    clearGlobalTimeout();
    const container = document.getElementById('dynamicContainer');
    container.innerHTML = `<div id="projectSummaryPanel"><h2>Project Subtasks View: ${parentName}</h2></div>`;
    const viewNode = document.getElementById('projectSummaryPanel');

    const projectSubtasks = sortedTasks.filter(t => t.name.startsWith(parentName + ':'));
    let subEstSum = 0;
    let listItemsStr = "";
    
    projectSubtasks.forEach(s => {
        subEstSum += s.estimatedTime;
        listItemsStr += `<li>${s.name} (Allocation: ${s.estimatedTime}m)</li>`;
    });

    const metricsCard = document.createElement('p');
    metricsCard.innerHTML = `Combined Sub-tree Target Total: <strong>${subEstSum} Minutes</strong>`;
    viewNode.appendChild(metricsCard);

    const ul = document.createElement('ul');
    ul.innerHTML = listItemsStr;
    viewNode.appendChild(ul);

    const choicePanel = document.createElement('div');
    choicePanel.className = 'choice-box-container';

    const btnDownload = document.createElement('div');
    btnDownload.className = 'forced-choice-box';
    btnDownload.textContent = "Download Project CSV Manifest";
    btnDownload.onclick = () => executeIsolatedProjectCSVDownload(parentName, projectSubtasks);

    const btnReturn = document.createElement('div');
    btnReturn.className = 'forced-choice-box';
    btnReturn.style.background = '#eee';
    btnReturn.textContent = "Return to Master Dashboard";
    btnReturn.onclick = () => displaySortedTasks();

    choicePanel.appendChild(btnDownload);
    choicePanel.appendChild(btnReturn);
    viewNode.appendChild(choicePanel);
}

// Anchors fixed absolute deadline values across execution track arrays
function initializeAbsoluteScheduleTimeline() {
    overallStartTimestamp = Math.floor(Date.now() / 1000);
    let cumulativeSecondsOffset = 0;
    masterSchedule = [];
    
    sortedTasks.forEach(task => {
        cumulativeSecondsOffset += (task.estimatedTime * 60);
        masterSchedule.push(overallStartTimestamp + cumulativeSecondsOffset);
    });
}

// --- Step 5a & 5b: Mid-Session Checkpoint Interceptor Controls ---
function startDeadlineSetting() {
    clearGlobalTimeout();
    document.getElementById('stopWorkingBtn').classList.remove('hidden');
    
    if (currentTaskIndex >= sortedTasks.length) {
        displayStatsScreen();
        return;
    }

    const target = sortedTasks[currentTaskIndex];

    // If task has pre-saved data and it's the very first task, auto-skip prompt
    if (target.estimatedTime > 0 && currentTaskIndex === 0) {
        startFocusScreen();
        return;
    }

    const container = document.getElementById('dynamicContainer');
    container.innerHTML = `
        <div id="deadlinePage">
            <div class="timeout-banner">Auto-submitting 10m default fallback in 30 seconds...</div>
            <h2>${target.estimatedTime > 0 ? "Modify Target Duration Option" : "Establish Target Allocation Time"}</h2>
            <p>Active Task: <strong>${target.name}</strong></p>
            <input type="number" id="checkpointDurationInput" placeholder="Minutes (1-120)" value="${target.estimatedTime > 0 ? target.estimatedTime : ''}">
            <div class="choice-box-container">
                <div id="btnStartFocus" class="forced-choice-box">Initiate Focused Action Timer</div>
            </div>
        </div>
    `;

    startViewTimeout(() => {
        if (!(target.estimatedTime > 0)) {
            target.estimatedTime = 10;
            recalculateDownstreamScheduleFailsafes();
        }
        startFocusScreen();
    });

    document.getElementById('btnStartFocus').onclick = () => {
        const val = parseInt(document.getElementById('checkpointDurationInput').value, 10);
        if (isNaN(val) || val < 1 || val > 120) { alert("Values must map between 1 and 120 minutes."); return; }
        clearGlobalTimeout();
        
        target.estimatedTime = val;
        recalculateDownstreamScheduleFailsafes();
        startFocusScreen();
    };
    saveSession();
}

function recalculateDownstreamScheduleFailsafes() {
    let startingAnchor = overallStartTimestamp;
    let baseOffset = 0;
    for(let i = 0; i < currentTaskIndex; i++) {
        baseOffset += (sortedTasks[i].estimatedTime * 60);
    }
    let cumulativeSecondsOffset = baseOffset;
    for(let i = currentTaskIndex; i < sortedTasks.length; i++) {
        cumulativeSecondsOffset += (sortedTasks[i].estimatedTime * 60);
        masterSchedule[i] = startingAnchor + cumulativeSecondsOffset;
    }
}

// --- Step 6: Live Countdown Operations Control Window ---
function startFocusScreen() {
    clearGlobalTimeout();
    document.getElementById('stopWorkingBtn').classList.remove('hidden');

    const container = document.getElementById('dynamicContainer');
    container.innerHTML = `
        <div id="focusScreen">
            <h2>Active Focus Operation</h2>
            <p id="focusTaskLabel" style="font-size:18px;"></p>
            <p id="focusAbsoluteDeadlineDisplay" style="color:#555; font-style:italic;"></p>
            <div id="focusMetricsDisplayBlock" style="padding:15px; background:#f5f5f5; border-radius:6px; margin:15px 0; font-size:15px; line-height:1.6;"></div>
            <div id="timerClockDisplay" style="font-size:36px; font-weight:bold; margin:20px 0; font-family:monospace;">00:00</div>
            <div class="choice-box-container">
                <div id="btnDoneNext" class="forced-choice-box" style="background:#e8f5e9;">Done, Next!</div>
                <div id="btnFocusAddTask" class="forced-choice-box">Add New Task</div>
            </div>
        </div>
    `;

    const target = sortedTasks[currentTaskIndex];
    const targetAbsoluteDeadlineTimestamp = masterSchedule[currentTaskIndex];
    
    document.getElementById('focusTaskLabel').innerHTML = `Task: <strong>${target.name}</strong>`;
    
    const deadlineDateObj = new Date(targetAbsoluteDeadlineTimestamp * 1000);
    document.getElementById('focusAbsoluteDeadlineDisplay').textContent = `Absolute Schedule Target Milestone: ${deadlineDateObj.toLocaleTimeString()}`;

    function runEngineMetricsCalculationsUpdateTick() {
        const now = Math.floor(Date.now() / 1000);
        
        // Time Remaining for Current Task
        const currentTaskRemainingSeconds = targetAbsoluteDeadlineTimestamp - now;
        const absCurrent = Math.abs(currentTaskRemainingSeconds);
        const cMin = Math.floor(absCurrent / 60);
        const cSec = absCurrent % 60;
        const currentSign = currentTaskRemainingSeconds >= 0 ? "" : "-";
        
        // Time ahead/behind schedule so far
        const totalAllocatedTargetSecondsUpToNow = masterSchedule[currentTaskIndex] - overallStartTimestamp;
        const targetTimelineExpectedElapsed = overallStartTimestamp + totalAllocatedTargetSecondsUpToNow;
        const varianceSeconds = targetTimelineExpectedElapsed - now;
        const absVar = Math.abs(varianceSeconds);
        const vMin = Math.floor(absVar / 60);
        const vSec = absVar % 60;
        const scheduleStatusText = varianceSeconds >= 0 ? `${vMin}m ${vSec}s AHEAD of schedule` : `${vMin}m ${vSec}s BEHIND schedule`;

        // Estimated Time Remaining
        let runningDownstreamTargetSecondsSum = 0;
        for (let i = currentTaskIndex; i < sortedTasks.length; i++) {
            runningDownstreamTargetSecondsSum += (sortedTasks[i].estimatedTime * 60);
        }
        const totalSessionAbsoluteEndTimeTarget = overallStartTimestamp + runningDownstreamTargetSecondsSum; 
        const sessionRemainingSeconds = totalSessionAbsoluteEndTimeTarget - now;
        const absSession = Math.abs(sessionRemainingSeconds);
        const sMin = Math.floor(absSession / 60);
        const sSec = absSession % 60;

        document.getElementById('timerClockDisplay').textContent = `Time Remaining: ${currentSign}${cMin}:${cSec < 10 ? '0' : ''}${cSec}`;
        document.getElementById('timerClockDisplay').style.color = currentTaskRemainingSeconds >= 0 ? "green" : "red";

        document.getElementById('focusMetricsDisplayBlock').innerHTML = `
            <div>• <strong>Schedule Status:</strong> ${scheduleStatusText}</div>
            <div>• <strong>Estimated Session Balance Remaining:</strong> ${sMin}m ${sSec}s</div>
        `;
    }

    runEngineMetricsCalculationsUpdateTick();
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(runEngineMetricsCalculationsUpdateTick, 1000);

    // Done Next Execution Progression Click Hook
    document.getElementById('btnDoneNext').onclick = () => {
        clearInterval(timerInterval);
        const now = Math.floor(Date.now() / 1000);
        
        let elapsedCalculationSeconds = 0;
        if (currentTaskIndex === 0) {
            elapsedCalculationSeconds = now - overallStartTimestamp;
        } else {
            elapsedCalculationSeconds = now - masterSchedule[currentTaskIndex - 1];
        }
        
        target.actualTime = Math.max(1, Math.ceil(elapsedCalculationSeconds / 60));

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
        startAddTask();
    };
    saveSession();
}

// --- Step 7b: Task List Queue Injection Module Screen ---
function startAddTask() {
    clearGlobalTimeout();
    document.getElementById('stopWorkingBtn').classList.add('hidden');
    const container = document.getElementById('dynamicContainer');
    container.innerHTML = `<div id="addTaskPage"><h2>Insert Target Task Into Fleet Queue</h2></div>`;
    const viewNode = document.getElementById('addTaskPage');

    const layout = document.createElement('div');
    layout.className = 'insertion-layout';

    const leftCol = document.createElement('div');
    leftCol.className = 'insertion-column';
    leftCol.innerHTML = `<h3>Active Core Matrix Lineup:</h3>`;
    const ol = document.createElement('ol');
    ol.start = 1;

    sortedTasks.forEach((t, idx) => {
        const li = document.createElement('li');
        li.innerHTML = `<strong>[Slot ${idx + 1}]</strong> ${t.name}`;
        if (idx < currentTaskIndex) {
            li.style.color = '#aaa';
            li.innerHTML += ' <em>(Processed)</em>';
        } else if (idx === currentTaskIndex) {
            li.style.background = '#fffde7';
            li.innerHTML += ' <em>(Active Foreground Item)</em>';
        }
        ol.appendChild(li);
    });
    leftCol.appendChild(ol);

    const rightCol = document.createElement('div');
    rightCol.className = 'insertion-column';
    rightCol.innerHTML = `
        <h3>New Specification:</h3>
        <textarea id="manualTaskNameInput" rows="3" placeholder="Type instructions..."></textarea>
        <p>Target Slot Position Index:</p>
        <input type="number" id="manualSlotNumberInput" min="${currentTaskIndex + 1}" max="${sortedTasks.length + 1}" value="${currentTaskIndex + 1}">
        <div class="choice-box-container" style="margin-top:20px;">
            <div id="btnCommitManualInsertion" class="forced-choice-box" style="background:#e3f2fd;">Insert & Review Dashboard</div>
        </div>
    `;

    layout.appendChild(leftCol);
    layout.appendChild(rightCol);
    viewNode.appendChild(layout);

    document.getElementById('btnCommitManualInsertion').onclick = () => {
        const text = document.getElementById('manualTaskNameInput').value.trim();
        const slot = parseInt(document.getElementById('manualSlotNumberInput').value, 10);

        if (!text) { alert("Descriptions must contain character entries."); return; }
        if (isNaN(slot) || slot < (currentTaskIndex + 1) || slot > (sortedTasks.length + 1)) {
            alert("Specified insertion bounds out of valid scope parameters.");
            return;
        }

        const freshObj = { name: text, estimatedTime: 0, actualTime: 0 };
        sortedTasks.splice(slot - 1, 0, freshObj);
        
        masterSchedule = []; 
        displaySortedTasks();
    };
    saveSession();
}

// --- Step 7c Action Route: Stop Working Execution Flow Trigger ---
document.getElementById('stopWorkingBtn').onclick = () => {
    if (timerInterval) clearInterval(timerInterval);
    
    if (document.getElementById('focusScreen') && currentTaskIndex < sortedTasks.length) {
        const now = Math.floor(Date.now() / 1000);
        let elapsedCalculationSeconds = 0;
        if (currentTaskIndex === 0) {
            elapsedCalculationSeconds = now - overallStartTimestamp;
        } else {
            elapsedCalculationSeconds = now - masterSchedule[currentTaskIndex - 1];
        }
        sortedTasks[currentTaskIndex].actualTime = Math.max(1, Math.ceil(elapsedCalculationSeconds / 60));
    }

    document.getElementById('stopWorkingBtn').classList.add('hidden');
    executeRemainingTasksCSVExport();
    displayStatsScreen();
};

function executeRemainingTasksCSVExport() {
    let csv = "Task Name,Estimated Time (Min),Actual Time (Min)\n";
    const balance = sortedTasks.slice(currentTaskIndex);
    balance.forEach(t => {
        csv += `"${t.name.replace(/"/g, '""')}",${t.estimatedTime},${t.actualTime}\n`;
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = "remaining_incomplete_tasks.csv";
    link.click();
}

// --- Step 8: Cumulative Evaluation Stats Screen view ---
function displayStatsScreen() {
    clearGlobalTimeout();
    document.getElementById('stopWorkingBtn').classList.add('hidden');
    const container = document.getElementById('dynamicContainer');
    container.innerHTML = `<div id="completionScreen"><h2>Session Report Metrics</h2></div>`;
    const viewNode = document.getElementById('completionScreen');

    const finalClockNow = Math.floor(Date.now() / 1000);
    
    let sessionDeltaScoreSeconds = 0;
    if (masterSchedule.length > 0) {
        const targetSessionFinalDeadline = masterSchedule[masterSchedule.length - 1];
        sessionDeltaScoreSeconds = targetSessionFinalDeadline - finalClockNow;
    }

    const netScoreMinutes = Math.floor(Math.abs(sessionDeltaScoreSeconds) / 60);
    const scoreTextElement = document.createElement('h3');
    if (sessionDeltaScoreSeconds >= 0) {
        scoreTextElement.textContent = `Overall Score Result: Finished ${netScoreMinutes} Minutes AHEAD of your precalculated schedule!`;
        scoreTextElement.style.color = "green";
    } else {
        scoreTextElement.textContent = `Overall Score Result: Finished ${netScoreMinutes} Minutes BEHIND your precalculated schedule constraints.`;
        scoreTextElement.style.color = "red";
    }
    viewNode.appendChild(scoreTextElement);

    const projectAggregatesMap = {};
    const standaloneRowLogArray = [];

    sortedTasks.forEach(task => {
        const varianceValue = task.estimatedTime - task.actualTime;
        
        if (task.name.includes(':')) {
            const tiers = task.name.split(':');
            let currentPathString = "";
            
            tiers.forEach((tierToken, levelIndex) => {
                if (levelIndex === tiers.length - 1) return; 
                currentPathString = currentPathString ? `${currentPathString}:${tierToken}` : tierToken;
                
                if (!projectAggregatesMap[currentPathString]) {
                    projectAggregatesMap[currentPathString] = { estTotal: 0, actTotal: 0 };
                }
                projectAggregatesMap[currentPathString].estTotal += task.estimatedTime;
                projectAggregatesMap[currentPathString].actTotal += task.actualTime;
            });
        }
        standaloneRowLogArray.push(`<li><strong>${task.name}</strong> | Target: ${task.estimatedTime}m vs Spent: ${task.actualTime}m (Variance: ${varianceValue >= 0 ? '+' : ''}${varianceValue}m)</li>`);
    });

    const breakdownTitle = document.createElement('h4');
    breakdownTitle.textContent = "Aggregated Project Tier Performance Metrics Summary:";
    viewNode.appendChild(breakdownTitle);

    const projectUl = document.createElement('ul');
    Object.keys(projectAggregatesMap).forEach(key => {
        const pObj = projectAggregatesMap[key];
        const pVar = pObj.estTotal - pObj.actTotal;
        const li = document.createElement('li');
        li.style.fontWeight = "bold";
        li.style.color = "#006064";
        li.textContent = `Project Tier Total [${key}] -> Target Combined: ${pObj.estTotal}m | Real Actual: ${pObj.actTotal}m (Total Offset: ${pVar >= 0 ? '+' : ''}${pVar}m)`;
        projectUl.appendChild(li);
    });
    viewNode.appendChild(projectUl);

    const logsTitle = document.createElement('h4');
    logsTitle.textContent = "Detailed Work Item Operational Records Lineup:";
    viewNode.appendChild(logsTitle);

    const itemsUl = document.createElement('ul');
    itemsUl.innerHTML = standaloneRowLogArray.join('');
    viewNode.appendChild(itemsUl);

    const actionBox = document.createElement('div');
    actionBox.className = 'choice-box-container';

    const btnDownloadFullCSV = document.createElement('div');
    btnDownloadFullCSV.className = 'forced-choice-box';
    btnDownloadFullCSV.textContent = "Download Session Logs (CSV)";
    btnDownloadFullCSV.onclick = () => {
        let csv = "Task Name,Estimated Allocation (Min),Actual Spent (Min),Variance (Min)\n";
        sortedTasks.forEach(t => {
            csv += `"${t.name.replace(/"/g, '""')}",${t.estimatedTime},${t.actualTime},${t.estimatedTime - t.actualTime}\n`;
        });
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = "complete_session_metrics_log.csv";
        link.click();
    };

    const btnRestartFresh = document.createElement('div');
    btnRestartFresh.className = 'forced-choice-box';
    btnRestartFresh.style.background = '#eceff1';
    btnRestartFresh.textContent = "Clear and Start Fresh Session";
    btnRestartFresh.onclick = () => {
        clearSession();
        window.location.reload();
    };

    actionBox.appendChild(btnDownloadFullCSV);
    actionBox.appendChild(btnRestartFresh);
    viewNode.appendChild(actionBox);
    saveSession();
}

// --- Interactive Merge Sorter Engines ---
function startMergeSort(array) {
    mergeSortInteractive(array).then(res => {
        sortedTasks = res.map(name => ({ name, estimatedTime: 0, actualTime: 0 }));
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

// Global Core Initialization Entry Event Hook
window.addEventListener('DOMContentLoaded', loadSession);
