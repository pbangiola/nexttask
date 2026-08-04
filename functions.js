//helper, ux, and utility functions outside core functionality
//ux functions

//reset button
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
    overlay.className = 'modal-overlay';

    overlay.innerHTML = `
        <div class="modal-box">
            <p class="modal-title">What would you like to do?</p>
            <button id="restartStepBtn" class="modal-btn">Restart This Step</button>
            <button id="restartAllBtn" class="modal-btn">Restart From the Beginning</button>
            <button id="cancelModalBtn" class="modal-btn modal-btn-cancel">Cancel</button>
        </div>
    `;

    document.body.appendChild(overlay);

    // Attach click handlers
    document.getElementById('restartStepBtn').addEventListener('click', () => {
        overlay.remove();
        restartCurrentScreen();
    });

    document.getElementById('restartAllBtn').addEventListener('click', async () => {
        overlay.remove();
        await clearSession();
        window.location.reload();
    });

    document.getElementById('cancelModalBtn').addEventListener('click', () => {
        overlay.remove();
    });
}
// Reset buttomn actions
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
