'use strict';

//timing functions for the session and tasks
function checkpointTask(task, now = Date.now()) {
    ensureTask(task);
    if (task.lastChanged !== null) {
        task.actualTimeMs += Math.max(0, now - task.lastChanged);
        task.lastChanged = now;
    }
}
function startTaskClock(task, now = Date.now()) { ensureTask(task); if (task.started === null) task.started = now; task.lastChanged = now; task.status = 'active'; activeTaskId = task.id; }
function pauseTaskClock(task, now = Date.now()) { checkpointTask(task, now); task.lastChanged = null; if (!task.completed && task.status !== 'blocked') task.status = 'pending'; }
function completeTask(task, now = Date.now()) { checkpointTask(task, now); task.lastChanged = null; task.completed = true; task.completedTime = now; task.status = 'completed'; task.blockedByTaskId = null; }

function formatDuration(ms, alwaysHours = false) {
    const totalSeconds = Math.floor(Math.abs(ms) / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const mmss = `${String(minutes).padStart(2,'0')}:${String(seconds).padStart(2,'0')}`;
    return alwaysHours || hours > 0 ? `${hours}:${mmss}` : mmss;
}

function allocatedTimeMs() { return incompleteTasks().reduce((sum, task) => sum + Math.max(0, task.estimatedTimeMs || 0), 0); }
function estimatedComparisonCount(taskCount) { return taskCount <= 1 ? 0 : Math.ceil(taskCount * Math.log2(taskCount)); }
function estimatedSortingTimeMs(taskCount) { return Math.ceil(3_000 * taskCount * Math.log2(Math.max(1, taskCount))); }
 
function sessionTimeRemainingMs(now = Date.now()) {
    return hasHardStop() ? hardStopAtMs - now : null;
}


function clearSessionTiming() {
    clearInterval(hardStopInterval);
    hardStopInterval = null;
    totalAvailableTimeMs = 0;
    sessionStartedAtMs = 0;
    hardStopAtMs = 0;
    hardStopHandled = false;
}

function startHardStopWatch() {
    clearInterval(hardStopInterval);
    hardStopInterval = null;

    if (!hasHardStop() || hardStopHandled) return;

    const checkHardStop = () => {
        if (Date.now() >= hardStopAtMs) handleHardStop();
    };

    checkHardStop();
    if (!hardStopHandled) hardStopInterval = setInterval(checkHardStop, 250);
}

function handleHardStop() {
    if (hardStopHandled || !hasHardStop()) return;

    hardStopHandled = true;
    clearInterval(hardStopInterval);
    hardStopInterval = null;
    clearInterval(timerInterval);

    const task = currentTask();
    if (task && task.lastChanged !== null) {
        pauseTaskClock(task, hardStopAtMs);
    }

    activeTaskId = firstIncompleteTask()?.id || null;
    save('session-ended');
    showSessionEnded();
}


