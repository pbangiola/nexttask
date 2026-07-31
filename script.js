let sortedTasks = []; // Holds objects: { name: "Task", estimatedTime: 0, actualTime: 0, timestamps: {} }
let currentTaskIndex = 0;
let timerInterval = null;
let deadline = 0;
let spareTime = 0; 
let taskStartTimestamp = 0; 
let pausedSecondsRemaining = 0; 

// Track overall session time limits and end event
let totalAvailableTime = 0;
let endConstraint = "";

// Global tracking for session & sorting timestamps
let sessionStartTimestamp = null;
let currentStepStartTimestamp = null;
let sortStartTime = 0;

// Helper: Format timestamp into human-readable local time
function formatRealTime(msTimestamp) {
    if (!msTimestamp) return 'N/A';
    return new Date(msTimestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// Helper: Generate date-time string formatted for file naming (YYYY-MM-DD_HH-MM)
function getFormattedDateTimeForFilename() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day}_${hours}-${minutes}`;
}

// Helper: Track step transitions with real-time logs
function logStepTransition(stepName) {
    const now = Date.now();
    currentStepStartTimestamp = now;
    console.log(`[Real-Time Log] Moved to step: "${stepName}" at ${formatRealTime(now)}`);
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

// --- Persistence Layer ---
function saveSession() {
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
    localStorage.setItem('taskSorterSession', JSON.stringify(sessionState));
}

function loadSession() {
    const saved = localStorage.getItem('taskSorterSession');
    if (!saved) return;

    try {
        const state = JSON.parse(saved);
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

        if (sortedTasks.length > 0 || state.activeView === 'time-constraint' || state.activeView === 'input') {
            document.getElementById('modeSelect').classList.add('hidden');
            routeToStoredView(state.activeView);
        }
    } catch (e) {
        console.error("Error restoring session:", e);
    }
}

function clearSession() {
    localStorage.removeItem('taskSorterSession');
}

function getActiveViewContext() {
    if (document.getElementById('focusScreen')) return 'focus';
    if (document.getElementById('deadlinePage')) return 'deadline';
    if (document.getElementById('addTaskPage')) return 'add-task';
    if (document.getElementById('completionScreen')) return 'completion';
    if (sortedTasks.length > 0 && document.getElementById('taskInput').classList.contains('hidden')) return 'dashboard';
    
    if (!document.getElementById('taskInput').classList.contains('hidden')) return 'input';
    if (!document.getElementById('timeConstraintInput').classList.contains('hidden')) return 'time-constraint';
    if (!document.getElementById('modeSelect').classList.contains('hidden')) return 'mode-select';

    return 'input';
}

function routeToStoredView(view) {
    if (view === 'time-constraint') {
        document.getElementById('timeConstraintInput').classList.remove('hidden');
    } else if (view === 'input') {
        document.getElementById('taskInput').classList.remove('hidden');
    } else if (view === 'focus') {
        const nowSec = Math.floor(Date.now() / 1000);
        if (deadline > nowSec) {
            startFocusScreen();
        } else {
            displaySortedTasks();
        }
    } else if (view === 'deadline') {
        startDeadlineSetting();
    } else if (view === 'add-task') {
        startAddTask();
    } else if (view === 'completion') {
        displaySpareTime();
    } else {
        displaySortedTasks();
    }
}
// ------------------------------

// Initializing Event Listeners
document.getElementById('csvUpload').addEventListener('change', handleCSVUpload);
document.getElementById('stopWorkingBtn').addEventListener('click', handleStopWorking);

// Step 1 -> Step 2: Mode Selection -> Time & Constraint Screen
document.getElementById('workBtn').addEventListener('click', () => {
    sessionStartTimestamp = Date.now();
    logStepTransition('Time & Constraint Setup');

    document.getElementById('modeSelect').classList.add('hidden');
    document.getElementById('timeConstraintInput').classList.remove('hidden');
    saveSession();
});

// Step 2 -> Step 3: Time & Constraint Screen -> Task Input Screen
document.getElementById('timeConstraintNextBtn').addEventListener('click', () => {
    const timeVal = parseInt(document.getElementById('availableTime').value, 10);
    const constraintVal = document.getElementById('endConstraint').value.trim();

    if (!timeVal || timeVal <= 0) {
        alert("Please enter a valid amount of available minutes.");
        return;
    }

    totalAvailableTime = timeVal;
    endConstraint = constraintVal;

    logStepTransition('Task Input');

    document.getElementById('timeConstraintInput').classList.add('hidden');
    
    const taskInputContainer = document.getElementById('taskInput');
    taskInputContainer.classList.remove('hidden');
    
    const taskTextArea = document.getElementById('tasks');
    if (!taskTextArea.dataset.capacityListener) {
        taskTextArea.addEventListener('input', checkTaskInputCapacity);
        taskTextArea.dataset.capacityListener = "true";
    }

    saveSession();
});

// Calculate capacity at task entry (10 mins per task assumption)
function checkTaskInputCapacity() {
    const textarea = document.getElementById('tasks');
    const rawTasks = textarea.value.split('\n').map(t => t.trim()).filter(t => t);
    
    const allowedTaskCount = Math.floor(totalAvailableTime / 10);

    let infoMsg = document.getElementById('capacityInfoMsg');
    if (!infoMsg) {
        infoMsg = document.createElement('p');
        infoMsg.id = 'capacityInfoMsg';
        infoMsg.style.fontWeight = 'bold';
        textarea.parentNode.insertBefore(infoMsg, textarea.nextSibling);
    }

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

// Check for existing session right at boot
window.addEventListener('DOMContentLoaded', loadSession);

// Handle Initial Task Sorter Submission
document.getElementById('startSort').addEventListener('click', () => {
    const taskInput = document.getElementById('tasks').value.trim();
    if (!taskInput) {
        alert('Task list cannot be empty!');
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
            actualTime: 0,
            timestamps: { created: Date.now(), started: null, completed: null } 
        }));
        currentTaskIndex = 0;
        saveSession();
        promptForUpfrontTimings();
    } else {
        logStepTransition('Interactive Merge Sort');
        sortStartTime = Math.floor(Date.now() / 1000);
        startMergeSort(rawTasks);
    }
});

// CSV Session Resumption
function handleCSVUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        const text = e.target.result;
        const lines = text.split('\n').map(line => line.trim()).filter(line => line);
        
        if (lines.length <= 1) {
            alert("Invalid or empty CSV file structure.");
            return;
        }

        const parsedTasks = [];
        let runningCompletedCount = 0;

        for (let i = 1; i < lines.length; i++) {
            const matches = lines[i].match(/(".*?"|[^,]+)(?=\s*,|\s*$|\s*\n)/g);
            if (!matches || matches.length < 3) continue;

            const name = matches[0].replace(/^"|"$/g, '').trim();
            const estimatedTime = parseInt(matches[1], 10) || 0;
            const actualTime = parseInt(matches[2], 10) || 0;

            parsedTasks.push({ 
                name, 
                estimatedTime, 
                actualTime,
                timestamps: { created: Date.now(), started: null, completed: actualTime > 0 ? Date.now() : null } 
            });

            if (actualTime > 0) {
                runningCompletedCount++;
            }
        }

        if (parsedTasks.length === 0) {
            alert("No valid task data rows matched your target upload format.");
            return;
        }

        if (!sessionStartTimestamp) sessionStartTimestamp = Date.now();
        logStepTransition('Dashboard (CSV Upload)');

        document.getElementById('timeConstraintInput').classList.add('hidden');
        document.getElementById('taskInput').classList.add('hidden');

        sortedTasks = parsedTasks;
        currentTaskIndex = runningCompletedCount; 
        
        saveSession();
        displaySortedTasks();
    };
    reader.readAsText(file);
}

// Upfront Timings Gateway Motif
function promptForUpfrontTimings() {
    logStepTransition('Upfront Timings Gateway');
    document.getElementById('taskCompare').classList.add('hidden');
    const container = document.getElementById('dynamicContainer');
    container.innerHTML = '';

    const gatewayScreen = document.createElement('div');
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

    logStepTransition(`Setting Timing for Task ${index + 1}`);

    const container = document.getElementById('dynamicContainer');
    container.innerHTML = '';

    const timingScreen = document.createElement('div');
    const targetTask = sortedTasks[index];

    const title = document.createElement('h2');
    title.textContent = `Set estimate for task (${index + 1} of ${sortedTasks.length})`;
    timingScreen.appendChild(title);

    const remainingTime = totalAvailableTime > 0 ? (totalAvailableTime - currentAllocated) : null;
    if (remainingTime !== null) {
        const timeCapMsg = document.createElement('p');
        timeCapMsg.style.fontWeight = 'bold';
        timeCapMsg.textContent = `Remaining unallocated session time: ${remainingTime} min`;
        timingScreen.appendChild(timeCapMsg);
    }

    const taskLabel = document.createElement('p');
    taskLabel.innerHTML = `Task: <strong>${targetTask.name}</strong>`;
    timingScreen.appendChild(taskLabel);

    const input = document.createElement('input');
    input.type = 'number';
    input.placeholder = 'Enter minutes (1-120)';
    if (targetTask.estimatedTime > 0) input.value = targetTask.estimatedTime;
    timingScreen.appendChild(input);

    const nextBtn = document.createElement('button');
    nextBtn.textContent = index === sortedTasks.length - 1 ? 'Finish and View List' : 'Next Task';
    
    nextBtn.addEventListener('click', () => {
        const timeVal = parseInt(input.value, 10);
        if (timeVal >= 1 && timeVal <= 120) {
            targetTask.estimatedTime = timeVal;
            saveSession();
            runSequentialTimingInput(index + 1); 
        } else {
            alert('Please specify an estimate between 1 and 120 minutes.');
        }
    });
    timingScreen.appendChild(nextBtn);

    container.appendChild(timingScreen);
    saveSession();
}

// Main Dashboard Listing
function displaySortedTasks() {
    logStepTransition('Sorted Task List Dashboard');

    document.getElementById('taskCompare').classList.add('hidden');
    document.getElementById('stopWorkingBtn').classList.add('hidden'); 
    
    const container = document.getElementById('dynamicContainer');
    container.innerHTML = ''; 

    const taskResult = document.createElement('div');
    taskResult.id = 'taskResult';

    const title = document.createElement('h2');
    title.textContent = 'Sorted Task List';
    taskResult.appendChild(title);

    if (sessionStartTimestamp) {
        const sessionTimeInfo = document.createElement('p');
        sessionTimeInfo.style.color = '#555';
        sessionTimeInfo.style.fontSize = '0.9em';
        sessionTimeInfo.textContent = `Session started at: ${formatRealTime(sessionStartTimestamp)}`;
        taskResult.appendChild(sessionTimeInfo);
    }

    let cumulativeEstTime = 0;
    const sortedList = document.createElement('ol');
    
    sortedTasks.forEach((task, idx) => {
        const li = document.createElement('li');
        cumulativeEstTime += task.estimatedTime || 10; 

        if (idx < currentTaskIndex) {
            const diff = task.estimatedTime - task.actualTime;
            const completedAt = task.timestamps?.completed ? ` | Done at ${formatRealTime(task.timestamps.completed)}` : '';
            li.textContent = `${task.name} (Done | Est: ${task.estimatedTime}m, Act: ${task.actualTime}m, Diff: ${diff}m${completedAt})`;
            li.style.color = 'gray';
            li.style.textDecoration = 'line-through';
        } else {
            li.textContent = task.name;
            if (task.estimatedTime > 0) {
                li.textContent += ` (Estimated: ${task.estimatedTime}m)`;
            }
            if (idx === currentTaskIndex && pausedSecondsRemaining > 0) {
                li.textContent += " [Paused Session In Progress]";
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
                const nowSec = Math.floor(Date.now() / 1000);
                deadline = nowSec + pausedSecondsRemaining;
                startFocusScreen();
            } else {
                startDeadlineSetting();
            }
        });
        taskResult.appendChild(getToWorkBtn);
    } else {
        const completeBtn = document.createElement('button');
        completeBtn.textContent = 'View Final Efficiency Report';
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
    resetBtn.addEventListener('click', () => {
        if (confirm("Are you sure you want to delete this session?")) {
            clearSession();
            window.location.reload();
        }
    });
    taskResult.appendChild(resetBtn);

    container.appendChild(taskResult);
    saveSession();
}

// Deadline Setup
function startDeadlineSetting() {
    logStepTransition('Setting Task Deadline');
    document.getElementById('stopWorkingBtn').classList.remove('hidden'); 

    const nextTask = sortedTasks[currentTaskIndex];
    
    if (nextTask.estimatedTime > 0) {
        const nowMs = Date.now();
        if (!nextTask.timestamps) nextTask.timestamps = {};
        nextTask.timestamps.started = nowMs; 
        
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
    input.placeholder = 'Enter minutes (1-120)';
    deadlinePage.appendChild(input);

    const startButton = document.createElement('button');
    startButton.textContent = 'Start Task';
    startButton.addEventListener('click', () => {
        const time = parseInt(input.value, 10);
        if (time >= 1 && time <= 120) {
            nextTask.estimatedTime = time; 
            const nowMs = Date.now();
            if (!nextTask.timestamps) nextTask.timestamps = {};
            nextTask.timestamps.started = nowMs; 

            taskStartTimestamp = Math.floor(nowMs / 1000); 
            deadline = taskStartTimestamp + (time * 60);
            pausedSecondsRemaining = 0;
            startFocusScreen();
        } else {
            alert('Please enter a valid time between 1 and 120 minutes.');
        }
    });
    deadlinePage.appendChild(startButton);

    container.appendChild(deadlinePage);
    saveSession();
}

// Live Execution Focus Panel
function startFocusScreen() {
    logStepTransition('Focus Screen');
    document.getElementById('stopWorkingBtn').classList.remove('hidden'); 

    const container = document.getElementById('dynamicContainer');
    container.innerHTML = '';

    const focusScreen = document.createElement('div');
    focusScreen.id = 'focusScreen';

    const currentTask = sortedTasks[currentTaskIndex];

    const taskName = document.createElement('h2');
    taskName.textContent = `Current Task: ${currentTask.name}`;
    focusScreen.appendChild(taskName);

    const timeAccessInfo = document.createElement('p');
    timeAccessInfo.style.fontSize = '0.9em';
    timeAccessInfo.style.color = '#666';
    timeAccessInfo.textContent = `Task accessed at: ${formatRealTime(currentTask.timestamps?.started)}`;
    focusScreen.appendChild(timeAccessInfo);

    const timerDisplay = document.createElement('p');
    timerDisplay.id = 'timer';
    timerDisplay.style.fontSize = '24px';
    timerDisplay.style.fontWeight = 'bold';
    focusScreen.appendChild(timerDisplay);

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
            alert(`Time is up! Your available session window (${endConstraint || 'time limit'}) has ended.`);
            handleStopWorking();
        }
    }

    updateTimer();
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(updateTimer, 1000);

    const doneNext = document.createElement('button');
    doneNext.textContent = 'Done, Next!';
    doneNext.addEventListener('click', () => {
        clearInterval(timerInterval);

        const nowMs = Date.now();
        const nowSec = Math.floor(nowMs / 1000);
        
        const actualElapsedMs = nowMs - (currentTask.timestamps.started || (taskStartTimestamp * 1000));
        currentTask.actualTime += Math.ceil(actualElapsedMs / (1000 * 60));
        currentTask.timestamps.completed = nowMs;

        const timeDifference = deadline - nowSec;
        spareTime += timeDifference;

        pausedSecondsRemaining = 0; 
        currentTaskIndex++; 

        if (currentTaskIndex < sortedTasks.length) {
            startDeadlineSetting();
        } else {
            document.getElementById('stopWorkingBtn').classList.add('hidden');
            displaySpareTime();
        }
    });
    focusScreen.appendChild(doneNext);

    const addTask = document.createElement('button');
    addTask.textContent = 'Add New Task';
    addTask.addEventListener('click', () => {
        clearInterval(timerInterval);
        
        const nowMs = Date.now();
        const nowSec = Math.floor(nowMs / 1000);
        
        const actualElapsedMs = nowMs - (currentTask.timestamps.started || (taskStartTimestamp * 1000));
        currentTask.actualTime += Math.ceil(actualElapsedMs / (1000 * 60));
        pausedSecondsRemaining = deadline - nowSec;
        
        startAddTask();
    });
    focusScreen.appendChild(addTask);

    container.appendChild(focusScreen);
    saveSession();
}

// Step 1: Handle Stop Working with Uncompleted Task Verification Prompt
function handleStopWorking() {
    clearInterval(timerInterval);
    
    // Log elapsed time for current active task if stopping mid-focus
    if (document.getElementById('focusScreen') && currentTaskIndex < sortedTasks.length) {
        const nowMs = Date.now();
        const nowSec = Math.floor(nowMs / 1000);
        const task = sortedTasks[currentTaskIndex];
        
        const actualElapsedMs = nowMs - (task.timestamps?.started || (taskStartTimestamp * 1000));
        task.actualTime += Math.ceil(actualElapsedMs / (1000 * 60));
        task.timestamps.completed = nowMs;
        spareTime += (deadline - nowSec);
        currentTaskIndex++;
    }

    document.getElementById('stopWorkingBtn').classList.add('hidden');

    const uncompleted = sortedTasks.slice(currentTaskIndex);

    if (uncompleted.length > 0) {
        renderUncompletedChecklistScreen(uncompleted);
    } else {
        finalizeStopWorkingSession();
    }
}

// Step 2: Checklist screen for out-of-order completed tasks
function renderUncompletedChecklistScreen(uncompletedTasks) {
    logStepTransition('Uncompleted Tasks Out-of-Order Check');

    const container = document.getElementById('dynamicContainer');
    container.innerHTML = '';

    const checkScreen = document.createElement('div');
    checkScreen.id = 'outOfOrderCheckScreen';

    const title = document.createElement('h2');
    title.textContent = 'Did you finish any of these remaining tasks out of order?';
    checkScreen.appendChild(title);

    const instructions = document.createElement('p');
    instructions.textContent = 'Select any tasks you managed to complete before ending your session:';
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
    submitBtn.textContent = 'Confirm and Finalize Session';
    submitBtn.style.marginTop = '15px';
    
    submitBtn.addEventListener('click', () => {
        const checkboxes = form.querySelectorAll('input[type="checkbox"]:checked');
        const checkedIndices = Array.from(checkboxes).map(cb => parseInt(cb.value, 10));

        const newlyCompleted = [];
        const stillUncompleted = [];
        const nowMs = Date.now();

        uncompletedTasks.forEach((task, idx) => {
            if (checkedIndices.includes(idx)) {
                task.timestamps.completed = nowMs;
                if (!task.timestamps.started) task.timestamps.started = nowMs;
                newlyCompleted.push(task);
            } else {
                stillUncompleted.push(task);
            }
        });

        const originallyCompleted = sortedTasks.slice(0, currentTaskIndex);
        sortedTasks = [...originallyCompleted, ...newlyCompleted, ...stillUncompleted];
        currentTaskIndex = originallyCompleted.length + newlyCompleted.length;

        saveSession();
        finalizeStopWorkingSession();
    });

    checkScreen.appendChild(form);
    container.appendChild(checkScreen);
}

// Step 3: Trigger dual-format file downloads and render efficiency screen
function finalizeStopWorkingSession() {
    downloadAllTaskFiles();
    displaySpareTime();
}

function downloadAllTaskFiles() {
    exportCompletedTasksCSV();
    exportUncompletedTasksTXT();
}

// Export completed tasks with statistics to CSV (Timestamped filename)
function exportCompletedTasksCSV() {
    const completed = sortedTasks.slice(0, currentTaskIndex);
    if (completed.length === 0) return;

    let csvContent = "Task Name,Estimated Time (Min),Actual Time (Min),Difference (Min),Started At,Completed At\n";
    completed.forEach(task => {
        const diff = task.estimatedTime - task.actualTime;
        const sanitizedName = `"${task.name.replace(/"/g, '""')}"`;
        const startedAt = formatRealTime(task.timestamps?.started);
        const completedAt = formatRealTime(task.timestamps?.completed);

        csvContent += `${sanitizedName},${task.estimatedTime},${task.actualTime},${diff},${startedAt},${completedAt}\n`;
    });

    const filename = `completed_tasks_${getFormattedDateTimeForFilename()}.csv`;
    triggerFileDownload(csvContent, filename, 'text/csv;charset=utf-8;');
}

// Export uncompleted tasks to TXT plain text file (Timestamped filename)
function exportUncompletedTasksTXT() {
    const uncompleted = sortedTasks.slice(currentTaskIndex);
    if (uncompleted.length === 0) return;

    let txtContent = `Uncompleted Tasks (Exported on ${new Date().toLocaleString()})\n`;
    txtContent += "--------------------------------------------------\n\n";
    
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

// Targeted Numerical Index Insertion Panel
function startAddTask() {
    logStepTransition('Insert New Task');
    document.getElementById('stopWorkingBtn').classList.add('hidden'); 

    const container = document.getElementById('dynamicContainer');
    container.innerHTML = '';

    const addTaskPage = document.createElement('div');
    addTaskPage.id = 'addTaskPage';

    const title = document.createElement('h2');
    title.textContent = 'Insert New Task Into List';
    addTaskPage.appendChild(title);

    const layout = document.createElement('div');
    layout.className = 'insertion-layout';

    const leftCol = document.createElement('div');
    leftCol.className = 'insertion-column';
    const leftTitle = document.createElement('h3');
    leftTitle.textContent = 'Current Master Queue:';
    leftCol.appendChild(leftTitle);

    const listContainer = document.createElement('ol');
    listContainer.start = 1; 
    sortedTasks.forEach((task, idx) => {
        const item = document.createElement('li');
        item.innerHTML = `<strong>[Slot ${idx + 1}]</strong> ${task.name}`;
        if (idx < currentTaskIndex) {
            item.style.color = '#ccc';
            item.innerHTML += ' <em>(Done)</em>';
        } else if (idx === currentTaskIndex) {
            item.style.backgroundColor = '#fff9c4';
            item.innerHTML += ' <em>(Current Active Anchor)</em>';
        }
        listContainer.appendChild(item);
    });
    
    const terminalSlot = document.createElement('li');
    terminalSlot.style.listStyleType = 'none';
    terminalSlot.innerHTML = `<em>[Slot ${sortedTasks.length + 1}] Push to absolute bottom layout end</em>`;
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
    input.placeholder = 'Type task instructions here...';
    rightCol.appendChild(input);

    const label = document.createElement('p');
    label.innerHTML = `Where should this task go in the list? (Min: ${currentTaskIndex + 1}, Max: ${sortedTasks.length + 1}):`;
    rightCol.appendChild(label);

    const slotInput = document.createElement('input');
    slotInput.type = 'number';
    slotInput.min = currentTaskIndex + 1;
    slotInput.max = sortedTasks.length + 1;
    slotInput.value = currentTaskIndex + 1; 
    rightCol.appendChild(slotInput);

    const saveButton = document.createElement('button');
    saveButton.textContent = 'Save and Resume Work';
    saveButton.addEventListener('click', () => {
        const taskName = input.value.trim();
        const targetSlot = parseInt(slotInput.value, 10);

        if (!taskName) {
            alert('Please supply valid task documentation text strings.');
            return;
        }

        if (isNaN(targetSlot) || targetSlot < (currentTaskIndex + 1) || targetSlot > (sortedTasks.length + 1)) {
            alert(`Please choose a number between ${currentTaskIndex + 1} and ${sortedTasks.length + 1}.`);
            return;
        }

        const newTaskObj = { 
            name: taskName, 
            estimatedTime: 0, 
            actualTime: 0,
            timestamps: { created: Date.now(), started: null, completed: null }
        };
        const arrayInsertionIndex = targetSlot - 1; 

        sortedTasks.splice(arrayInsertionIndex, 0, newTaskObj);
        
        displaySortedTasks();
    });
    rightCol.appendChild(saveButton);

    layout.appendChild(leftCol);
    layout.appendChild(rightCol);
    addTaskPage.appendChild(layout);

    container.appendChild(addTaskPage);
    saveSession();
}

// Final Efficiency Report Screen
function displaySpareTime() {
    logStepTransition('Final Efficiency Report');
    document.getElementById('stopWorkingBtn').classList.add('hidden');

    const container = document.getElementById('dynamicContainer');
    container.innerHTML = '';

    const completionScreen = document.createElement('div');
    completionScreen.id = 'completionScreen';

    const title = document.createElement('h2');
    title.textContent = 'Tasks Finished / Stopped';
    completionScreen.appendChild(title);

    if (sessionStartTimestamp) {
        const sessionSummary = document.createElement('p');
        sessionSummary.style.fontWeight = 'bold';
        sessionSummary.textContent = `Session started: ${formatRealTime(sessionStartTimestamp)} | Completed at: ${formatRealTime(Date.now())}`;
        completionScreen.appendChild(sessionSummary);
    }

    const spareTimeDisplay = document.createElement('p');
    const absSpareTime = Math.abs(spareTime);
    const hours = Math.floor(absSpareTime / 3600);
    const minutes = Math.floor((absSpareTime % 3600) / 60);
    const seconds = absSpareTime % 60;
    spareTimeDisplay.textContent = `Time Remaining: ${spareTime >= 0 ? '' : '-'}${hours}:${minutes < 10 ? '0' : ''}:${seconds < 10 ? '0' : ''}${seconds}`;
    spareTimeDisplay.style.color = spareTime >= 0 ? 'green' : 'red';
    completionScreen.appendChild(spareTimeDisplay);

    const breakdownTitle = document.createElement('h3');
    breakdownTitle.textContent = 'Detailed Timing Logs:';
    completionScreen.appendChild(breakdownTitle);

    const reportList = document.createElement('ul');
    sortedTasks.forEach(task => {
        const item = document.createElement('li');
        const variance = task.estimatedTime - task.actualTime;
        const startTimeStr = task.timestamps?.started ? formatRealTime(task.timestamps.started) : 'N/A';
        const completionTimeStr = task.timestamps?.completed ? formatRealTime(task.timestamps.completed) : 'N/A';
        
        item.textContent = `${task.name} | Est: ${task.estimatedTime}m | Act: ${task.actualTime}m | Var: ${variance >= 0 ? '+' : ''}${variance}m [Start: ${startTimeStr}, End: ${completionTimeStr}]`;
        reportList.appendChild(item);
    });
    completionScreen.appendChild(reportList);

    const downloadBtn = document.createElement('button');
    downloadBtn.textContent = 'Download Files Again (CSV & TXT)';
    downloadBtn.addEventListener('click', downloadAllTaskFiles);
    completionScreen.appendChild(downloadBtn);

    const resetBtn = document.createElement('button');
    resetBtn.textContent = 'Start Fresh Session';
    resetBtn.style.marginLeft = '15px';
    resetBtn.addEventListener('click', () => {
        clearSession();
        window.location.reload();
    });
    completionScreen.appendChild(resetBtn);

    container.appendChild(completionScreen);
    saveSession();
}

// Interactive Merge Sort Foundations
function startMergeSort(array) {
    const totalEstComparisons = getEstimatedComparisons(array.length);
    const estSeconds = totalEstComparisons * 3;
    const estMinutes = Math.max(1, Math.ceil(estSeconds / 60));

    mergeSortInteractive(array, estMinutes).then(sortedNames => {
        const sortEndTime = Math.floor(Date.now() / 1000);
        const actualSortMinutes = Math.max(1, Math.ceil((sortEndTime - sortStartTime) / 60));

        const userTasks = sortedNames.map(name => ({ 
            name, 
            estimatedTime: 0, 
            actualTime: 0,
            timestamps: { created: Date.now(), started: null, completed: null }
        }));

        const sortCreditTask = {
            name: "Sorting tasks",
            estimatedTime: estMinutes,
            actualTime: actualSortMinutes,
            timestamps: { created: sessionStartTimestamp, started: sessionStartTimestamp, completed: Date.now() }
        };

        sortedTasks = [sortCreditTask, ...userTasks];
        currentTaskIndex = 1; 

        saveSession();
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
