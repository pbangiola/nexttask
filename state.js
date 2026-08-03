// ============================================================================
// 1. CONFIG & GLOBAL STATE
// ============================================================================
const MAX_TASK_MINUTES = 20;

// Session & Routing State
let sessionId = localStorage.getItem('taskSorterSessionId');
if (!sessionId) {
    sessionId = 'session_' + Math.random().toString(36).substring(2, 9);
    localStorage.setItem('taskSorterSessionId', sessionId);
}

let sortedTasks = []; // Array: { name, estimatedTime, actualTimeMs, timestamps: {} }
let currentTaskIndex = 0;
let currentSortRawTasks = [];

// Session Time Constraints
let hasHardstop = false;
let totalAvailableTime = 0; // 0 means no time constraint
let endConstraint = "";

// Timer & Execution State
let timerInterval = null;
let deadline = 0;
let spareTime = 0;
let taskStartTimestamp = 0;
let pausedSecondsRemaining = 0;
let sortStartTime = 0;
let isSortClickLocked = false; // Prevents rapid-click race conditions in merge sort

// Session Tracking Timestamps
let sessionStartTimestamp = null;
let currentStepStartTimestamp = null;

// ============================================================================
// 2. SHARED UI HELPERS & MODALS
// ============================================================================
function showStartOverBtn() {
    document.getElementById('startOverBtn')?.classList.remove('hidden');
}

function hideStartOverBtn() {
    document.getElementById('startOverBtn')?.classList.add('hidden');
}

function showStartOverPrompt() {
    if (document.getElementById('startOverModal')) return;

    const overlay = document.createElement('div');
    overlay.id = 'startOverModal';
    overlay.className = 'modal-overlay';

    const box = document.createElement('div');
    box.className = 'modal-box';

    const msg = document.createElement('p');
    msg.textContent = 'What would you like to do?';
    msg.style.fontWeight = 'bold';
    box.appendChild(msg);

    const restartStepBtn = document.createElement('button');
    restartStepBtn.textContent = 'Restart This Step';
    restartStepBtn.className = 'btn btn-full';
    restartStepBtn.addEventListener('click', () => {
        overlay.remove();
        restartCurrentScreen();
    });
    box.appendChild(restartStepBtn);

    const restartAllBtn = document.createElement('button');
    restartAllBtn.textContent = 'Restart From the Beginning';
    restartAllBtn.className = 'btn btn-full';
    restartAllBtn.addEventListener('click', async () => {
        overlay.remove();
        await clearSession();
        window.location.reload();
    });
    box.appendChild(restartAllBtn);

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.className = 'btn btn-full btn-secondary';
    cancelBtn.addEventListener('click', () => overlay.remove());
    box.appendChild(cancelBtn);

    overlay.appendChild(box);
    document.body.appendChild(overlay);
}

function restartCurrentScreen() {
    if (!document.getElementById('timeConstraintInput').classList.contains('hidden')) {
        document.getElementById('availableTime').value = '';
        document.getElementById('endConstraint').value = '';
        totalAvailableTime = 0;
        endConstraint = "";
    } else if (!document.getElementById('taskInput').classList.contains('hidden')) {
        document.getElementById('tasks').value = '';
        document.getElementById('skipSortCheckbox').checked = false;
        checkTaskInputCapacity();
    } else if (!document.getElementById('taskCompare').classList.contains('hidden')) {
        sortedTasks = [];
        currentTaskIndex = 0;
        document.getElementById('dynamicContainer').innerHTML = '';
        document.getElementById('taskCompare').classList.add('hidden');
        document.getElementById('tasks').value = currentSortRawTasks.join('\n');
        document.getElementById('taskInput').classList.remove('hidden');
        checkTaskInputCapacity();
    } else if (document.getElementById('timingGatewayScreen')) {
        promptForUpfrontTimings();
    } else if (document.getElementById('timingEntryScreen')) {
        for (let i = 1; i < sortedTasks.length; i++) {
            sortedTasks[i].estimatedTime = 0;
        }
        runSequentialTimingInput(1);
    }
    saveSession();
}

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

    if (!hasHardstop || totalAvailableTime <= 0) {
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

function getActualMinutes(task) {
    return Math.round((task.actualTimeMs || 0) / 60000);
}

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

function getFormattedDateTimeForFilename() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day}_${hours}-${minutes}`;
}

function getTotalAllocatedTime() {
    return sortedTasks.reduce((sum, task) => sum + (task.estimatedTime || 0), 0);
}