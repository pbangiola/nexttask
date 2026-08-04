// --- Config ---
const MAX_TASK_MINUTES = 20;

// Holds the raw (pre-sort) task names so a mid-sort "restart this screen" can recover them
let currentSortRawTasks = [];

function showStartOverBtn() {
    document.getElementById('startOverBtn')?.classList.remove('hidden');
}

function hideStartOverBtn() {
    document.getElementById('startOverBtn')?.classList.add('hidden');
}

// Shows a three-option overlay: restart just the current step, restart the
// whole session, or cancel and return to whatever was on screen.
function showStartOverPrompt() {
    if (document.getElementById('startOverModal')) return; // already open

    const overlay = document.createElement('div');
    overlay.id = 'startOverModal';
    overlay.style.position = 'fixed';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.width = '100%';
    overlay.style.height = '100%';
    overlay.style.backgroundColor = 'rgba(0,0,0,0.4)';
    overlay.style.display = 'flex';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.style.zIndex = '1000';

    const box = document.createElement('div');
    box.style.backgroundColor = '#fff';
    box.style.padding = '20px';
    box.style.borderRadius = '8px';
    box.style.maxWidth = '320px';
    box.style.width = '85%';
    box.style.textAlign = 'center';

    const msg = document.createElement('p');
    msg.textContent = 'What would you like to do?';
    msg.style.fontWeight = 'bold';
    box.appendChild(msg);

    const restartStepBtn = document.createElement('button');
    restartStepBtn.textContent = 'Restart This Step';
    restartStepBtn.style.display = 'block';
    restartStepBtn.style.width = '100%';
    restartStepBtn.style.margin = '8px 0';
    restartStepBtn.addEventListener('click', () => {
        overlay.remove();
        restartCurrentScreen();
    });
    box.appendChild(restartStepBtn);

    const restartAllBtn = document.createElement('button');
    restartAllBtn.textContent = 'Restart From the Beginning';
    restartAllBtn.style.display = 'block';
    restartAllBtn.style.width = '100%';
    restartAllBtn.style.margin = '8px 0';
    restartAllBtn.addEventListener('click', async () => {
        overlay.remove();
        await clearSession();
        window.location.reload();
    });
    box.appendChild(restartAllBtn);

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.style.display = 'block';
    cancelBtn.style.width = '100%';
    cancelBtn.style.margin = '8px 0';
    cancelBtn.style.backgroundColor = '#eceff1';
    cancelBtn.addEventListener('click', () => {
        overlay.remove();
    });
    box.appendChild(cancelBtn);

    overlay.appendChild(box);
    document.body.appendChild(overlay);
}

// Resets just the current step, without wiping the whole session
function restartCurrentScreen() {
    if (!document.getElementById('timeConstraintInput').classList.contains('hidden')) {
        document.getElementById('availableTime').value = '';
        document.getElementById('endConstraint').value = '';

    } else if (!document.getElementById('taskInput').classList.contains('hidden')) {
        document.getElementById('tasks').value = '';
        document.getElementById('skipSortCheckbox').checked = false;
        checkTaskInputCapacity();

    } else if (!document.getElementById('taskCompare').classList.contains('hidden')) {
        // Mid-sorting: drop the in-progress sort, return to task entry with the list preserved
        sortedTasks = [];
        currentTaskIndex = 0;
        document.getElementById('dynamicContainer').innerHTML = '';
        document.getElementById('taskCompare').classList.add('hidden');
        document.getElementById('tasks').value = currentSortRawTasks.join('\n');
        document.getElementById('taskInput').classList.remove('hidden');
        checkTaskInputCapacity();

    } else if (document.getElementById('timingGatewayScreen')) {
        // Nothing entered yet on this screen - just re-render it
        promptForUpfrontTimings();

    } else if (document.getElementById('timingEntryScreen')) {
        // Mid-estimating: clear any estimates entered so far, restart from the first task
        for (let i = 1; i < sortedTasks.length; i++) {
            sortedTasks[i].estimatedTime = 0;
        }
        runSequentialTimingInput(1);
    }
    // mode-select / work-choice screens have nothing to reset

    saveSession();
}

// --- Session ID & Initialization ---
let sessionId = localStorage.getItem('taskSorterSessionId');
if (!sessionId) {
    sessionId = 'session_' + Math.random().toString(36).substring(2, 9);
    localStorage.setItem('taskSorterSessionId', sessionId);
}

let sortedTasks = []; // Array: { name, estimatedTime, actualTimeMs, timestamps: {} }
let currentTaskIndex = 0;
let timerInterval = null;
let deadline = 0;
let spareTime = 0; 
let taskStartTimestamp = 0; 
let pausedSecondsRemaining = 0; 

// Track overall session constraints
let totalAvailableTime = 0;
let endConstraint = "";

// Global tracking timestamps (saved in state, hidden from UI)
let sessionStartTimestamp = null;
let currentStepStartTimestamp = null;
let sortStartTime = 0;

// Helper: Generate date-time string for file naming (YYYY-MM-DD_HH-MM)
function getFormattedDateTimeForFilename() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day}_${hours}-${minutes}`;
}

// Helper: Estimate maximum comparison steps for Merge Sort
function getEstimatedComparisons(n) {
    if (n <= 1) return 0;
    return Math.ceil(n * Math.log2(n));
}

// Helper: Calculate total estimated time allocated so far
function getTotalAllocatedTime() {
    return sortedTasks.reduce((sum, task) => sum + (task.estimatedTime || 0), 0);
}

// Ported from the "main" branch: live warning on the task-entry screen, before any
// per-task estimates exist. Uses a rough 10 min/task assumption against the available
// time set on the previous screen, so the person gets a heads-up before they even sort.
function checkTaskInputCapacity() {
    const textarea = document.getElementById('tasks');
    if (!textarea) return;

    const rawTasks = textarea.value.split('\n').map(t => t.trim()).filter(t => t);

    let infoMsg = document.getElementById('capacityInfoMsg');
    if (!infoMsg) {
        infoMsg = document.createElement('p');
        infoMsg.id = 'capacityInfoMsg';
        infoMsg.style.fontWeight = 'bold';
        textarea.parentNode.insertBefore(infoMsg, textarea.nextSibling);
    }

    if (totalAvailableTime <= 0) {
        infoMsg.textContent = '';
        textarea.classList.remove('over-capacity');
        return;
    }

    const allowedTaskCount = Math.floor(totalAvailableTime / 10);

    if (rawTasks.length > allowedTaskCount) {
        textarea.classList.add('over-capacity');
        infoMsg.textContent = `Warning: Based on ~10 min/task, you can likely complete ${allowedTaskCount} task(s) in your ${totalAvailableTime} min window. Tasks past line ${allowedTaskCount} exceed available time.`;
        infoMsg.style.color = '#d32f2f';
    } else {
        textarea.classList.remove('over-capacity');
        infoMsg.textContent = `Allocated capacity: ${rawTasks.length * 10} / ${totalAvailableTime} minutes estimated.`;
        infoMsg.style.color = '#2e7d32';
    }
}

// Helper: Round raw elapsed milliseconds to whole minutes - for display only, never for storage
function getActualMinutes(task) {
    return Math.round((task.actualTimeMs || 0) / 60000);
}

// Helper: Natural-language summary of how a task's actual time compared to its estimate
function describeTaskTiming(estimatedTime, actualMinutes) {
    const diff = estimatedTime - actualMinutes;
    const minuteWord = actualMinutes === 1 ? 'minute' : 'minutes';

    let comparison;
    if (diff > 0) {
        comparison = `${diff} minute${diff === 1 ? '' : 's'} ahead of schedule`;
    } else if (diff < 0) {
        comparison = `${Math.abs(diff)} minute${Math.abs(diff) === 1 ? '' : 's'} behind schedule`;
    } else {
        comparison = 'right on schedule';
    }

    return `finished in ${actualMinutes} ${minuteWord}, ${comparison}`;
}

// --- Persistence Layer, Task Queue, & User Analytics Sync ---
async function saveSession() {
    const sessionState = {
        sortedTasks,
        currentTaskIndex,
        deadline,
        spareTime,
        taskStartTimestamp,
        pausedSecondsRemaining,
        totalAvailableTime,
        endConstraint,
        sessionStartTimestamp,
        currentStepStartTimestamp,
        activeView: getActiveViewContext() 
    };

    localStorage.setItem('taskSorterSession_fallback', JSON.stringify(sessionState));

    try {
        await fetch(`/api/session/${sessionId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(sessionState)
        });
    } catch (e) {
        console.warn("Backend sync failed, state preserved in browser cache:", e);
    }
}

async function loadSession() {
    let state = null;

    try {
        const res = await fetch(`/api/session/${sessionId}`);
        if (res.ok) {
            state = await res.json();
        }
    } catch (e) {
        console.warn("Could not reach backend, checking browser cache...", e);
    }

    if (!state) {
        const saved = localStorage.getItem('taskSorterSession_fallback');
        if (saved) {
            try { state = JSON.parse(saved); } catch (e) {}
        }
    }

    if (!state) {
        return;
    }

    try {
        sortedTasks = state.sortedTasks || [];
        currentTaskIndex = state.currentTaskIndex || 0;
        deadline = state.deadline || 0;
        spareTime = state.spareTime || 0;
        taskStartTimestamp = state.taskStartTimestamp || 0;
        pausedSecondsRemaining = state.pausedSecondsRemaining || 0;
        totalAvailableTime = state.totalAvailableTime || 0;
        endConstraint = state.endConstraint || "";
        sessionStartTimestamp = state.sessionStartTimestamp || null;
        currentStepStartTimestamp = state.currentStepStartTimestamp || null;

        if (state.activeView && state.activeView !== 'mode-select') {
            document.getElementById('modeSelect')?.classList.add('hidden');
            document.getElementById('timeConstraintInput')?.classList.add('hidden');
            document.getElementById('taskInput')?.classList.add('hidden');

            routeToStoredView(state.activeView);
        }
    } catch (e) {
        console.error("Error restoring session state:", e);
    }
}

async function fetchExistingQueue() {
    try {
        const res = await fetch(`/api/session/${sessionId}/queue`);
        if (res.ok) {
            const data = await res.json();
            return data.queue || [];
        }
    } catch (e) {
        console.warn("Failed to load existing task list from backend:", e);
    }
    return [];
}

// Full replace: pushes the current pending (not-yet-completed) task list to the
// backend queue, including each task's elapsed time so far. Called whenever the
// pending set changes structurally (list finalized, task added).
async function syncPendingQueueToBackend() {
    const pending = sortedTasks.slice(currentTaskIndex).map(task => ({
        name: task.name,
        estimatedTime: task.estimatedTime || 0,
        elapsedMs: task.actualTimeMs || 0
    }));

    try {
        await fetch(`/api/session/${sessionId}/queue`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tasks: pending })
        });
    } catch (e) {
        console.warn("Failed to sync pending queue to backend:", e);
    }
}

// Removes a single task from the backend's pending queue. Called any time a
// task is completed, so the queue never has to be reconciled in one big batch.
async function removeTaskFromQueue(taskName) {
    try {
        await fetch(`/api/session/${sessionId}/queue/remove`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ taskName })
        });
    } catch (e) {
        console.warn("Failed to remove task from server queue:", e);
    }
}

async function clearSession() {
    try {
        await fetch(`/api/session/${sessionId}`, { method: 'DELETE' });
    } catch (e) {
        console.error("Failed to delete session on server:", e);
    }
    localStorage.removeItem('taskSorterSessionId');
    localStorage.removeItem('taskSorterSession_fallback');
}

async function logTaskCompletionToBackend(task) {
    try {
        await fetch(`/api/session/${sessionId}/tasks/completed`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                taskName: task.name,
                estimatedMinutes: task.estimatedTime || 0,
                actualMinutes: Math.round((task.actualTimeMs || 0) / 60000),
                completedAt: task.timestamps?.completed || Date.now()
            })
        });
    } catch (e) {
        console.warn("Failed to push completed task log to backend:", e);
    }
}

function getActiveViewContext() {
    if (document.getElementById('focusScreen')) return 'focus';
    if (document.getElementById('deadlinePage')) return 'deadline';
    if (document.getElementById('addTaskPage')) return 'add-task';
    if (document.getElementById('completionScreen')) return 'completion';
    if (sortedTasks.length > 0 && document.getElementById('taskInput').classList.contains('hidden')) return 'dashboard';
    
    if (!document.getElementById('taskInput').classList.contains('hidden')) return 'input';
    if (!document.getElementById('timeConstraintInput').classList.contains('hidden')) return 'time-constraint';
    if (!document.getElementById('workChoiceStep').classList.contains('hidden')) return 'work-choice';
    if (!document.getElementById('modeSelect').classList.contains('hidden')) return 'mode-select';

    return 'input';
}

function routeToStoredView(view) {
    const nowSec = Math.floor(Date.now() / 1000);

    switch (view) {
        case 'work-choice':
            document.getElementById('workChoiceStep')?.classList.remove('hidden');
            showStartOverBtn();
            break;
        case 'time-constraint':
            document.getElementById('timeConstraintInput')?.classList.remove('hidden');
            showStartOverBtn();
            break;
        case 'input':
            document.getElementById('taskInput')?.classList.remove('hidden');
            checkTaskInputCapacity();
            showStartOverBtn();
            break;
        case 'focus':
            hideStartOverBtn();
            if (deadline > nowSec || pausedSecondsRemaining > 0) {
                startFocusScreen();
            } else {
                displaySortedTasks();
            }
            break;
        case 'deadline':
            hideStartOverBtn();
            startDeadlineSetting();
            break;
        case 'add-task':
            hideStartOverBtn();
            startAddTask();
            break;
        case 'completion':
            hideStartOverBtn();
            displaySpareTime();
            break;
        case 'dashboard':
        default:
            hideStartOverBtn();
            displaySortedTasks();
            break;
    }
}

// --- App Initialization & Event Handlers ---
function initApp() {
    document.getElementById('csvUpload')?.addEventListener('change', handleCSVUpload);
    document.getElementById('stopWorkingBtn')?.addEventListener('click', handleStopWorking);
    document.getElementById('tasks')?.addEventListener('input', checkTaskInputCapacity);

    document.getElementById('startOverBtn')?.addEventListener('click', showStartOverPrompt);

    document.getElementById('workBtn')?.addEventListener('click', () => {
        sessionStartTimestamp = Date.now();
        document.getElementById('modeSelect').classList.add('hidden');
        document.getElementById('workChoiceStep').classList.remove('hidden');
        showStartOverBtn();
        saveSession();
    });

    document.getElementById('createNewListBtn')?.addEventListener('click', () => {
        document.getElementById('workChoiceStep').classList.add('hidden');
        document.getElementById('timeConstraintInput').classList.remove('hidden');
        showStartOverBtn();
        saveSession();
    });

    document.getElementById('resumeExistingListBtn')?.addEventListener('click', async () => {
        const queue = await fetchExistingQueue();

        if (queue.length === 0) {
            alert("There's no saved list to resume yet — let's start a new one.");
            return;
        }

        sortedTasks = queue.map(q => ({
            name: q.task_name,
            estimatedTime: q.estimated_minutes || 0,
            actualTimeMs: q.elapsed_ms || 0,
            timestamps: { created: Date.now(), started: null, completed: null }
        }));
        currentTaskIndex = 0;

        document.getElementById('workChoiceStep').classList.add('hidden');
        hideStartOverBtn();
        saveSession();

        // No sorting, no questions - go straight into the first task.
        startDeadlineSetting();
    });

    document.getElementById('timeConstraintNextBtn')?.addEventListener('click', () => {
        const timeVal = parseInt(document.getElementById('availableTime').value, 10);
        const constraintVal = document.getElementById('endConstraint').value.trim();

        if (!timeVal || timeVal <= 0) {
            alert("How many minutes do you have? Enter a number to continue.");
            return;
        }

        totalAvailableTime = timeVal;
        endConstraint = constraintVal;

        document.getElementById('timeConstraintInput').classList.add('hidden');
        
        const taskInputContainer = document.getElementById('taskInput');
        taskInputContainer.classList.remove('hidden');
        checkTaskInputCapacity();
        showStartOverBtn();
        saveSession();
    });

    document.getElementById('startSort')?.addEventListener('click', () => {
        const taskInput = document.getElementById('tasks').value.trim();
        if (!taskInput) {
            alert('Add at least one task to get started.');
            return;
        }

        let rawTasks = taskInput.split('\n').map(t => t.trim()).filter(t => t);
        rawTasks = [...new Set(rawTasks)];

        const skipSort = document.getElementById('skipSortCheckbox').checked;

        document.getElementById('taskInput').classList.add('hidden');

        if (skipSort || rawTasks.length <= 1) {
            sortedTasks = rawTasks.map(name => ({ 
                name, 
                estimatedTime: 0, 
                actualTimeMs: 0,
                timestamps: { created: Date.now(), started: null, completed: null } 
            }));
            currentTaskIndex = 0;
            saveSession();
            syncPendingQueueToBackend();
            promptForUpfrontTimings();
        } else {
            currentSortRawTasks = rawTasks;
            sortStartTime = Math.floor(Date.now() / 1000);
            startMergeSort(rawTasks);
        }
    });

    loadSession();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}

// CSV Session Resumption
function handleCSVUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        const text = e.target.result;
        const lines = text.split('\n').map(line => line.trim()).filter(line => line);
        
        if (lines.length <= 1) {
            alert("That file looks empty or isn't formatted right.");
            return;
        }

        const parsedTasks = [];
        let runningCompletedCount = 0;

        for (let i = 1; i < lines.length; i++) {
            const matches = lines[i].match(/(".*?"|[^,]+)(?=\s*,|\s*$|\s*\n)/g);
            if (!matches || matches.length < 3) continue;

            const name = matches[0].replace(/^"|"$/g, '').trim();
            const estimatedTime = parseInt(matches[1], 10) || 0;
            const actualMinutesFromFile = parseInt(matches[2], 10) || 0;

            parsedTasks.push({ 
                name, 
                estimatedTime, 
                actualTimeMs: actualMinutesFromFile * 60000,
                timestamps: { created: Date.now(), started: null, completed: actualMinutesFromFile > 0 ? Date.now() : null } 
            });

            if (actualMinutesFromFile > 0) {
                runningCompletedCount++;
            }
        }

        if (parsedTasks.length === 0) {
            alert("We couldn't find any tasks in that file — check the format and try again.");
            return;
        }

        if (!sessionStartTimestamp) sessionStartTimestamp = Date.now();

        document.getElementById('timeConstraintInput').classList.add('hidden');
        document.getElementById('taskInput').classList.add('hidden');

        sortedTasks = parsedTasks;
        currentTaskIndex = runningCompletedCount; 
        
        saveSession();
        syncPendingQueueToBackend();
        displaySortedTasks();
    };
    reader.readAsText(file);
}

// Upfront Timings Gateway Motif
function promptForUpfrontTimings() {
    document.getElementById('taskCompare').classList.add('hidden');
    const container = document.getElementById('dynamicContainer');
    container.innerHTML = '';

    const gatewayScreen = document.createElement('div');
    gatewayScreen.id = 'timingGatewayScreen';
    const question = document.createElement('h2');
    question.textContent = 'Do you want to set timings now?';
    gatewayScreen.appendChild(question);

    const yesBtn = document.createElement('button');
    yesBtn.textContent = 'Yes';
    yesBtn.addEventListener('click', () => {
        runSequentialTimingInput(currentTaskIndex);
    });
    gatewayScreen.appendChild(yesBtn);

    const noBtn = document.createElement('button');
    noBtn.textContent = 'No';
    noBtn.addEventListener('click', () => {
        displaySortedTasks();
    });
    gatewayScreen.appendChild(noBtn);

    container.appendChild(gatewayScreen);
    saveSession();
}

// Sequential Timing Entry Routine
function runSequentialTimingInput(index) {
    const currentAllocated = getTotalAllocatedTime();

    if (index >= sortedTasks.length || (totalAvailableTime > 0 && currentAllocated >= totalAvailableTime)) {
        displaySortedTasks();
        return;
    }

    const container = document.getElementById('dynamicContainer');
    container.innerHTML = '';

    const timingScreen = document.createElement('div');
    timingScreen.id = 'timingEntryScreen';
    const targetTask = sortedTasks[index];

    const title = document.createElement('h2');
    title.textContent = `Set estimate for task (${index + 1} of ${sortedTasks.length})`;
    timingScreen.appendChild(title);

    const remainingTime = totalAvailableTime > 0 ? (totalAvailableTime - currentAllocated) : null;
    if (remainingTime !== null) {
        const timeCapMsg = document.createElement('p');
        timeCapMsg.style.fontWeight = 'bold';
        timeCapMsg.textContent = `You have ${remainingTime} minute${remainingTime === 1 ? '' : 's'} left to plan for.`;
        timingScreen.appendChild(timeCapMsg);
    }

    const taskLabel = document.createElement('p');
    taskLabel.innerHTML = `Task: <strong>${targetTask.name}</strong>`;
    timingScreen.appendChild(taskLabel);

    const input = document.createElement('input');
    input.type = 'number';
    input.placeholder = `Enter minutes (1-${MAX_TASK_MINUTES})`;
    if (targetTask.estimatedTime > 0) input.value = targetTask.estimatedTime;
    timingScreen.appendChild(input);

    const nextBtn = document.createElement('button');
    nextBtn.textContent = index === sortedTasks.length - 1 ? 'Finish and View List' : 'Next Task';
    
    nextBtn.addEventListener('click', () => {
        const timeVal = parseInt(input.value, 10);
        if (timeVal >= 1 && timeVal <= MAX_TASK_MINUTES) {
            targetTask.estimatedTime = timeVal;
            saveSession();
            runSequentialTimingInput(index + 1); 
        } else {
            alert(`Please pick a number between 1 and ${MAX_TASK_MINUTES} minutes.`);
        }
    });
    timingScreen.appendChild(nextBtn);

    container.appendChild(timingScreen);
    saveSession();
}

// Main Dashboard Listing
function displaySortedTasks() {
    document.getElementById('taskCompare').classList.add('hidden');
    document.getElementById('stopWorkingBtn').classList.add('hidden'); 
    hideStartOverBtn();
    
    const container = document.getElementById('dynamicContainer');
    container.innerHTML = ''; 

    const taskResult = document.createElement('div');
    taskResult.id = 'taskResult';

    const title = document.createElement('h2');
    title.textContent = 'Sorted Task List';
    taskResult.appendChild(title);

    let cumulativeEstTime = 0;
    const sortedList = document.createElement('ol');
    
    sortedTasks.forEach((task, idx) => {
        const li = document.createElement('li');
        cumulativeEstTime += task.estimatedTime || 10; 

        if (idx < currentTaskIndex) {
            const actualMinutes = getActualMinutes(task);
            li.textContent = `${task.name} — ${describeTaskTiming(task.estimatedTime, actualMinutes)}`;
            li.style.color = 'gray';
            li.style.textDecoration = 'line-through';
        } else {
            li.textContent = task.name;
            if (task.estimatedTime > 0) {
                li.textContent += ` (Estimated: ${task.estimatedTime}m)`;
            }
            if (idx === currentTaskIndex && pausedSecondsRemaining > 0) {
                li.textContent += " [In Progress]";
            }

            if (totalAvailableTime > 0 && cumulativeEstTime > totalAvailableTime) {
                li.classList.add('over-capacity');
            }
        }
        sortedList.appendChild(li);
    });
    taskResult.appendChild(sortedList);

    if (currentTaskIndex < sortedTasks.length) {
        const getToWorkBtn = document.createElement('button');
        getToWorkBtn.textContent = pausedSecondsRemaining > 0 ? 'Resume Working' : 'Get to Work';
        getToWorkBtn.addEventListener('click', () => {
            if (pausedSecondsRemaining > 0) {
                const nowMs = Date.now();
                const nowSec = Math.floor(nowMs / 1000);
                sortedTasks[currentTaskIndex].timestamps.lastStarted = nowMs;
                deadline = nowSec + pausedSecondsRemaining;
                startFocusScreen();
            } else {
                startDeadlineSetting();
            }
        });
        taskResult.appendChild(getToWorkBtn);
    } else {
        const completeBtn = document.createElement('button');
        completeBtn.textContent = 'See How It Went';
        completeBtn.addEventListener('click', () => displaySpareTime());
        taskResult.appendChild(completeBtn);
    }

    const downloadBtn = document.createElement('button');
    downloadBtn.textContent = 'Download Tasks (CSV & TXT)';
    downloadBtn.addEventListener('click', downloadAllTaskFiles);
    taskResult.appendChild(downloadBtn);

    const resetBtn = document.createElement('button');
    resetBtn.textContent = 'Reset All and Start Over';
    resetBtn.style.backgroundColor = '#eceff1';
    resetBtn.style.marginLeft = '15px';
    resetBtn.addEventListener('click', async () => {
        if (confirm("This will clear everything and start you over. Continue?")) {
            await clearSession();
            window.location.reload();
        }
    });
    taskResult.appendChild(resetBtn);

    container.appendChild(taskResult);
    saveSession();
}

// Deadline Setup
function startDeadlineSetting() {
    document.getElementById('stopWorkingBtn').classList.remove('hidden'); 
    hideStartOverBtn();

    const nextTask = sortedTasks[currentTaskIndex];
    
    if (nextTask.estimatedTime > 0) {
        const nowMs = Date.now();
        if (!nextTask.timestamps) nextTask.timestamps = {};
        if (!nextTask.timestamps.started) nextTask.timestamps.started = nowMs; 
        nextTask.timestamps.lastStarted = nowMs;
        
        taskStartTimestamp = Math.floor(nowMs / 1000); 
        deadline = taskStartTimestamp + (nextTask.estimatedTime * 60);
        pausedSecondsRemaining = 0;
        startFocusScreen();
        return;
    }

    const container = document.getElementById('dynamicContainer');
    container.innerHTML = '';

    const deadlinePage = document.createElement('div');
    deadlinePage.id = 'deadlinePage';

    const taskName = document.createElement('h2');
    taskName.textContent = `Set a deadline for: ${nextTask.name}`;
    deadlinePage.appendChild(taskName);

    const input = document.createElement('input');
    input.type = 'number';
    input.id = 'taskTime';
    input.placeholder = `Enter minutes (1-${MAX_TASK_MINUTES})`;
    deadlinePage.appendChild(input);

    const startButton = document.createElement('button');
    startButton.textContent = 'Start Task';
    startButton.addEventListener('click', () => {
        const time = parseInt(input.value, 10);
        if (time >= 1 && time <= MAX_TASK_MINUTES) {
            nextTask.estimatedTime = time; 
            const nowMs = Date.now();
            if (!nextTask.timestamps) nextTask.timestamps = {};
            if (!nextTask.timestamps.started) nextTask.timestamps.started = nowMs; 
            nextTask.timestamps.lastStarted = nowMs;

            taskStartTimestamp = Math.floor(nowMs / 1000); 
            deadline = taskStartTimestamp + (time * 60);
            pausedSecondsRemaining = 0;
            startFocusScreen();
        } else {
            alert(`Please pick a number between 1 and ${MAX_TASK_MINUTES} minutes.`);
        }
    });
    deadlinePage.appendChild(startButton);

    container.appendChild(deadlinePage);
    saveSession();
}

// Live Execution Focus Panel
function startFocusScreen() {
    document.getElementById('stopWorkingBtn').classList.remove('hidden'); 

    const container = document.getElementById('dynamicContainer');
    container.innerHTML = '';

    const focusScreen = document.createElement('div');
    focusScreen.id = 'focusScreen';

    const currentTask = sortedTasks[currentTaskIndex];

    const taskName = document.createElement('h2');
    taskName.textContent = `Current Task: ${currentTask.name}`;
    focusScreen.appendChild(taskName);

    const timerDisplay = document.createElement('p');
    timerDisplay.id = 'timer';
    timerDisplay.style.fontSize = '24px';
    timerDisplay.style.fontWeight = 'bold';
    focusScreen.appendChild(timerDisplay);

    function finalizeCurrentTaskAndAdvance() {
        const nowMs = Date.now();

        const actualElapsedMs = nowMs - (currentTask.timestamps.lastStarted || (taskStartTimestamp * 1000));
        currentTask.actualTimeMs = (currentTask.actualTimeMs || 0) + actualElapsedMs;
        currentTask.timestamps.completed = nowMs;

        const timeDifference = deadline - Math.floor(nowMs / 1000);
        spareTime += timeDifference;

        logTaskCompletionToBackend(currentTask);
        removeTaskFromQueue(currentTask.name);

        pausedSecondsRemaining = 0;
        currentTaskIndex++;

        if (currentTaskIndex < sortedTasks.length) {
            startDeadlineSetting();
        } else {
            document.getElementById('stopWorkingBtn').classList.add('hidden');
            displaySpareTime();
        }
    }

    function updateTimer() {
        const nowSec = Math.floor(Date.now() / 1000);
        const timeRemaining = deadline - nowSec;

        timerDisplay.style.color = timeRemaining >= 0 ? 'green' : 'red';

        const absTime = Math.abs(timeRemaining);
        const minutes = Math.floor(absTime / 60);
        const seconds = absTime % 60;
        timerDisplay.textContent = `Time Remaining: ${timeRemaining >= 0 ? '' : '-'}${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;

        if (timeRemaining <= 0) {
            clearInterval(timerInterval);
            alert(`Time's up for "${currentTask.name}"! Let's move on to the next task.`);
            finalizeCurrentTaskAndAdvance();
        }
    }

    updateTimer();
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(updateTimer, 1000);

    const doneNext = document.createElement('button');
    doneNext.textContent = 'Done, Next!';
    doneNext.addEventListener('click', () => {
        clearInterval(timerInterval);
        finalizeCurrentTaskAndAdvance();
    });
    focusScreen.appendChild(doneNext);

    const addTask = document.createElement('button');
    addTask.textContent = 'Add New Task';
    addTask.addEventListener('click', () => {
        clearInterval(timerInterval);
        
        const nowMs = Date.now();
        const nowSec = Math.floor(nowMs / 1000);
        
        // Track elapsed time accumulated so far, in raw milliseconds - no rounding until display
        const actualElapsedMs = nowMs - (currentTask.timestamps.lastStarted || (taskStartTimestamp * 1000));
        currentTask.actualTimeMs = (currentTask.actualTimeMs || 0) + actualElapsedMs;
        
        // Save paused remaining timer state for seamless resumption
        pausedSecondsRemaining = deadline - nowSec;
        
        startAddTask();
    });
    focusScreen.appendChild(addTask);

    container.appendChild(focusScreen);
    saveSession();
}

// Stop Working routine & checklist verification
async function handleStopWorking() {
    clearInterval(timerInterval);
    
    if (document.getElementById('focusScreen') && currentTaskIndex < sortedTasks.length) {
        const nowMs = Date.now();
        const nowSec = Math.floor(nowMs / 1000);
        const task = sortedTasks[currentTaskIndex];
        
        const actualElapsedMs = nowMs - (task.timestamps?.lastStarted || (taskStartTimestamp * 1000));
        task.actualTimeMs = (task.actualTimeMs || 0) + actualElapsedMs;
        task.timestamps.completed = nowMs;
        spareTime += (deadline - nowSec);
        
        logTaskCompletionToBackend(task);
        currentTaskIndex++;
    }

    document.getElementById('stopWorkingBtn').classList.add('hidden');

    // Queue now reflects whatever's genuinely still pending - this also
    // drops the task just finished above and refreshes any estimate changes.
    await syncPendingQueueToBackend();

    const uncompleted = sortedTasks.slice(currentTaskIndex);

    if (uncompleted.length > 0) {
        renderUncompletedChecklistScreen(uncompleted);
    } else {
        finalizeStopWorkingSession();
    }
}

function renderUncompletedChecklistScreen(uncompletedTasks) {
    const container = document.getElementById('dynamicContainer');
    container.innerHTML = '';

    const checkScreen = document.createElement('div');
    checkScreen.id = 'outOfOrderCheckScreen';

    const title = document.createElement('h2');
    title.textContent = 'Finish anything early?';
    checkScreen.appendChild(title);

    const instructions = document.createElement('p');
    instructions.textContent = 'Check off anything you already finished:';
    checkScreen.appendChild(instructions);

    const form = document.createElement('form');
    form.id = 'uncompletedChecklistForm';

    uncompletedTasks.forEach((task, relativeIdx) => {
        const wrapper = document.createElement('div');
        wrapper.style.margin = '8px 0';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.id = `uncompleted_task_${relativeIdx}`;
        checkbox.value = relativeIdx;

        const label = document.createElement('label');
        label.htmlFor = `uncompleted_task_${relativeIdx}`;
        label.style.marginLeft = '8px';
        label.textContent = task.name;

        wrapper.appendChild(checkbox);
        wrapper.appendChild(label);
        form.appendChild(wrapper);
    });

    const submitBtn = document.createElement('button');
    submitBtn.type = 'button';
    submitBtn.textContent = 'Confirm and Continue';
    submitBtn.style.marginTop = '15px';
    
    submitBtn.addEventListener('click', async () => {
        const checkboxes = form.querySelectorAll('input[type="checkbox"]:checked');
        const checkedIndices = Array.from(checkboxes).map(cb => parseInt(cb.value, 10));

        const newlyCompleted = [];
        const stillUncompleted = [];
        const nowMs = Date.now();

        for (let idx = 0; idx < uncompletedTasks.length; idx++) {
            const task = uncompletedTasks[idx];
            if (checkedIndices.includes(idx)) {
                task.timestamps.completed = nowMs;
                if (!task.timestamps.started) task.timestamps.started = nowMs;
                newlyCompleted.push(task);
                await logTaskCompletionToBackend(task);
                await removeTaskFromQueue(task.name);
            } else {
                stillUncompleted.push(task);
            }
        }

        const originallyCompleted = sortedTasks.slice(0, currentTaskIndex);
        sortedTasks = [...originallyCompleted, ...newlyCompleted, ...stillUncompleted];
        currentTaskIndex = originallyCompleted.length + newlyCompleted.length;

        saveSession();
        finalizeStopWorkingSession();
    });

    checkScreen.appendChild(form);
    checkScreen.appendChild(submitBtn);
    container.appendChild(checkScreen);
}

function finalizeStopWorkingSession() {
    downloadAllTaskFiles();
    displaySpareTime();
}

function downloadAllTaskFiles() {
    exportCompletedTasksCSV();
    exportUncompletedTasksTXT();
}

function exportCompletedTasksCSV() {
    const completed = sortedTasks.slice(0, currentTaskIndex);
    if (completed.length === 0) return;

    let csvContent = "Task Name,Estimated Time (Min),Actual Time (Min),Difference (Min)\n";
    completed.forEach(task => {
        const actualMinutes = getActualMinutes(task);
        const diff = task.estimatedTime - actualMinutes;
        const sanitizedName = `"${task.name.replace(/"/g, '""')}"`;
        csvContent += `${sanitizedName},${task.estimatedTime},${actualMinutes},${diff}\n`;
    });

    const filename = `completed_tasks_${getFormattedDateTimeForFilename()}.csv`;
    triggerFileDownload(csvContent, filename, 'text/csv;charset=utf-8;');
}

function exportUncompletedTasksTXT() {
    const uncompleted = sortedTasks.slice(currentTaskIndex);
    if (uncompleted.length === 0) return;

    let txtContent = `Uncompleted Tasks\n--------------------------------------------------\n\n`;
    uncompleted.forEach((task, idx) => {
        txtContent += `${idx + 1}. ${task.name}\n`;
    });

    const filename = `uncompleted_tasks_${getFormattedDateTimeForFilename()}.txt`;
    triggerFileDownload(txtContent, filename, 'text/plain;charset=utf-8;');
}

function triggerFileDownload(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
}

function startAddTask() {
    document.getElementById('stopWorkingBtn').classList.add('hidden'); 

    const container = document.getElementById('dynamicContainer');
    container.innerHTML = '';

    const addTaskPage = document.createElement('div');
    addTaskPage.id = 'addTaskPage';

    const title = document.createElement('h2');
    title.textContent = 'Add New Task';
    addTaskPage.appendChild(title);

    const layout = document.createElement('div');
    layout.className = 'insertion-layout';

    const leftCol = document.createElement('div');
    leftCol.className = 'insertion-column';
    const leftTitle = document.createElement('h3');
    leftTitle.textContent = 'Current Queue:';
    leftCol.appendChild(leftTitle);

    const listContainer = document.createElement('ol');
    listContainer.start = 1; 
    sortedTasks.forEach((task, idx) => {
        const item = document.createElement('li');
        item.innerHTML = `<strong>${idx + 1}.</strong> ${task.name}`;
        if (idx < currentTaskIndex) {
            item.style.color = '#ccc';
            item.innerHTML += ' <em>(Done)</em>';
        } else if (idx === currentTaskIndex) {
            item.style.backgroundColor = '#fff9c4';
            item.innerHTML += ' <em>(Up now)</em>';
        }
        listContainer.appendChild(item);
    });
    
    const terminalSlot = document.createElement('li');
    terminalSlot.style.listStyleType = 'none';
    terminalSlot.innerHTML = `<em>${sortedTasks.length + 1}. (last)</em>`;
    listContainer.appendChild(terminalSlot);

    leftCol.appendChild(listContainer);

    const rightCol = document.createElement('div');
    rightCol.className = 'insertion-column';
    
    const rightTitle = document.createElement('h3');
    rightTitle.textContent = 'New Task:';
    rightCol.appendChild(rightTitle);

    const input = document.createElement('textarea');
    input.id = 'newTaskInput';
    input.rows = 4;
    input.cols = 30;
    input.placeholder = 'What do you need to add?';
    rightCol.appendChild(input);

    const label = document.createElement('p');
    label.innerHTML = `Where should this go? Pick a spot from ${currentTaskIndex + 1} to ${sortedTasks.length + 1}.`;
    rightCol.appendChild(label);

    const slotInput = document.createElement('input');
    slotInput.type = 'number';
    slotInput.min = currentTaskIndex + 1;
    slotInput.max = sortedTasks.length + 1;
    slotInput.value = currentTaskIndex + 1; 
    rightCol.appendChild(slotInput);

    const saveButton = document.createElement('button');
    saveButton.textContent = 'Save Task';
    saveButton.addEventListener('click', () => {
        const taskName = input.value.trim();
        const targetSlot = parseInt(slotInput.value, 10);

        if (!taskName) {
            alert('Give the task a name first.');
            return;
        }

        if (isNaN(targetSlot) || targetSlot < (currentTaskIndex + 1) || targetSlot > (sortedTasks.length + 1)) {
            alert(`Please pick a spot between ${currentTaskIndex + 1} and ${sortedTasks.length + 1}.`);
            return;
        }

        const newTaskObj = { 
            name: taskName, 
            estimatedTime: 0, 
            actualTimeMs: 0,
            timestamps: { created: Date.now(), started: null, completed: null }
        };
        const arrayInsertionIndex = targetSlot - 1; 

        sortedTasks.splice(arrayInsertionIndex, 0, newTaskObj);
        syncPendingQueueToBackend();
        
        // If user inserted the new task as current top priority, prompt for time estimate immediately
        if (arrayInsertionIndex === currentTaskIndex) {
            promptTimingForNewActiveTask(currentTaskIndex);
        } else {
            displaySortedTasks();
        }
    });
    rightCol.appendChild(saveButton);

    layout.appendChild(leftCol);
    layout.appendChild(rightCol);
    addTaskPage.appendChild(layout);

    container.appendChild(addTaskPage);
    saveSession();
}

function promptTimingForNewActiveTask(index) {
    const container = document.getElementById('dynamicContainer');
    container.innerHTML = '';

    const timingScreen = document.createElement('div');
    const targetTask = sortedTasks[index];

    const title = document.createElement('h2');
    title.textContent = `Set time estimate for new priority task`;
    timingScreen.appendChild(title);

    const taskLabel = document.createElement('p');
    taskLabel.innerHTML = `Task: <strong>${targetTask.name}</strong>`;
    timingScreen.appendChild(taskLabel);

    const input = document.createElement('input');
    input.type = 'number';
    input.placeholder = `Enter minutes (1-${MAX_TASK_MINUTES})`;
    timingScreen.appendChild(input);

    const startBtn = document.createElement('button');
    startBtn.textContent = 'Start New Task Now';
    startBtn.addEventListener('click', () => {
        const timeVal = parseInt(input.value, 10);
        if (timeVal >= 1 && timeVal <= MAX_TASK_MINUTES) {
            targetTask.estimatedTime = timeVal;
            const nowMs = Date.now();
            targetTask.timestamps.started = nowMs;
            targetTask.timestamps.lastStarted = nowMs;

            taskStartTimestamp = Math.floor(nowMs / 1000);
            deadline = taskStartTimestamp + (timeVal * 60);
            
            saveSession();
            startFocusScreen();
        } else {
            alert(`Please pick a number between 1 and ${MAX_TASK_MINUTES} minutes.`);
        }
    });
    timingScreen.appendChild(startBtn);

    container.appendChild(timingScreen);
}

function displaySpareTime() {
    document.getElementById('stopWorkingBtn').classList.add('hidden');

    const container = document.getElementById('dynamicContainer');
    container.innerHTML = '';

    const completionScreen = document.createElement('div');
    completionScreen.id = 'completionScreen';

    const title = document.createElement('h2');
    title.textContent = 'All Done!';
    completionScreen.appendChild(title);

    const spareTimeDisplay = document.createElement('p');
    const absSpareTime = Math.abs(spareTime);
    const hours = Math.floor(absSpareTime / 3600);
    const minutes = Math.floor((absSpareTime % 3600) / 60);
    const seconds = absSpareTime % 60;
    spareTimeDisplay.textContent = `Time Remaining: ${spareTime >= 0 ? '' : '-'}${hours}:${minutes < 10 ? '0' : ''}:${seconds < 10 ? '0' : ''}${seconds}`;
    spareTimeDisplay.style.color = spareTime >= 0 ? 'green' : 'red';
    completionScreen.appendChild(spareTimeDisplay);

    const breakdownTitle = document.createElement('h3');
    breakdownTitle.textContent = 'How Each Task Went:';
    completionScreen.appendChild(breakdownTitle);

    const reportList = document.createElement('ul');
    sortedTasks.forEach(task => {
        const item = document.createElement('li');
        const actualMinutes = getActualMinutes(task);
        item.textContent = `${task.name} — ${describeTaskTiming(task.estimatedTime, actualMinutes)}`;
        reportList.appendChild(item);
    });
    completionScreen.appendChild(reportList);

    const downloadBtn = document.createElement('button');
    downloadBtn.textContent = 'Download Files Again (CSV & TXT)';
    downloadBtn.addEventListener('click', downloadAllTaskFiles);
    completionScreen.appendChild(downloadBtn);

    const resetBtn = document.createElement('button');
    resetBtn.textContent = 'Start Over';
    resetBtn.style.marginLeft = '15px';
    resetBtn.addEventListener('click', async () => {
        await clearSession();
        window.location.reload();
    });
    completionScreen.appendChild(resetBtn);

    container.appendChild(completionScreen);
    saveSession();
}

function startMergeSort(array) {
    const totalEstComparisons = getEstimatedComparisons(array.length);
    const estSeconds = totalEstComparisons * 3;
    const estMinutes = Math.max(1, Math.ceil(estSeconds / 60));

    mergeSortInteractive(array, estMinutes).then(sortedNames => {
        const actualSortTimeMs = Date.now() - (sortStartTime * 1000);

        const userTasks = sortedNames.map(name => ({ 
            name, 
            estimatedTime: 0, 
            actualTimeMs: 0,
            timestamps: { created: Date.now(), started: null, completed: null }
        }));

        const sortCreditTask = {
            name: "Sorting tasks",
            estimatedTime: estMinutes,
            actualTimeMs: actualSortTimeMs,
            timestamps: { created: sessionStartTimestamp, started: sessionStartTimestamp, completed: Date.now() }
        };

        sortedTasks = [sortCreditTask, ...userTasks];
        currentTaskIndex = 1; 

        saveSession();
        syncPendingQueueToBackend();
        promptForUpfrontTimings();
    });
}

async function mergeSortInteractive(array, estMinutes) {
    if (array.length <= 1) return array;

    const middle = Math.floor(array.length / 2);
    const left = await mergeSortInteractive(array.slice(0, middle), estMinutes);
    const right = await mergeSortInteractive(array.slice(middle), estMinutes);

    return mergeInteractive(left, right, estMinutes);
}

function mergeInteractive(left, right, estMinutes) {
    return new Promise(resolve => {
        const result = [];

        function compareNext() {
            if (!left.length && !right.length) {
                document.getElementById('taskCompare').classList.add('hidden');
                resolve(result);
                return;
            }
            if (!left.length) {
                result.push(...right);
                document.getElementById('taskCompare').classList.add('hidden');
                resolve(result);
                return;
            }
            if (!right.length) {
                result.push(...left);
                document.getElementById('taskCompare').classList.add('hidden');
                resolve(result);
                return;
            }

            const compareContainer = document.getElementById('taskCompare');
            compareContainer.classList.remove('hidden');

            let estHeader = document.getElementById('sortEstimateHeader');
            if (!estHeader) {
                estHeader = document.createElement('p');
                estHeader.id = 'sortEstimateHeader';
                estHeader.style.fontWeight = 'bold';
                estHeader.style.color = '#555';
                compareContainer.insertBefore(estHeader, compareContainer.firstChild);
            }
            estHeader.textContent = `Estimated sorting time remaining: ~${estMinutes} min`;

            document.getElementById('task1').textContent = left[0];
            document.getElementById('task2').textContent = right[0];

            document.getElementById('task1').onclick = () => {
                result.push(left.shift());
                compareNext();
            };

            document.getElementById('task2').onclick = () => {
                result.push(right.shift());
                compareNext();
            };
        }

        compareNext();
    });
}
