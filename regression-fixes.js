// Targeted regression fixes for chatgpt-2.
(function installRegressionFixes() {
    function isTaskCompleted(task) {
        return Boolean(task?.completed || task?.completedTime || task?.timestamps?.completed || task?.status === 'completed');
    }

    function estimateMs(task) {
        return Math.max(0, Number(task?.estimatedTimeMs ?? (task?.estimatedTime || 0) * 60000));
    }

    function actualMs(task) {
        return Math.max(0, Number(task?.actualTimeMs || 0));
    }

    function formatSignedDuration(milliseconds) {
        const negative = milliseconds < 0;
        const totalSeconds = Math.floor(Math.abs(milliseconds) / 1000);
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;
        return `${negative ? '-' : ''}${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }

    function saveLocalSnapshot() {
        sortedTasks.forEach(ensureTaskId);
        const firstIncompleteIndex = sortedTasks.findIndex(task => !isTaskCompleted(task));
        currentTaskIndex = firstIncompleteIndex === -1 ? sortedTasks.length : firstIncompleteIndex;
        activeTaskId = sortedTasks[currentTaskIndex]?.id || null;

        const snapshot = {
            sortedTasks,
            activeTaskId,
            currentTaskIndex,
            spareTime,
            totalAvailableTime,
            endConstraint,
            sessionStartTimestamp,
            currentStepStartTimestamp,
            activeView: typeof getActiveViewContext === 'function' ? getActiveViewContext() : 'dashboard'
        };
        localStorage.setItem('taskSorterSession_fallback', JSON.stringify(snapshot));
        return snapshot;
    }

    async function fixedSaveSession() {
        saveLocalSnapshot();

        const payload = {
            tasks: sortedTasks.map((task, index) => taskToServerPayload(task, index + 1)),
            totalAvailableTimeMs: Number(totalAvailableTime || 0) * 60000,
            endConstraint
        };

        fetch(apiUrl(`/api/session/${sessionId}/tasks`), {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        }).then(response => {
            if (!response.ok) throw new Error(`Task-list backup failed (${response.status})`);
        }).catch(error => {
            console.warn('Server task-list backup failed; browser state is unchanged:', error);
        });
    }

    async function fixedFetchExistingQueue() {
        try {
            const response = await fetch(apiUrl(`/api/session/${sessionId}/tasks?incomplete=1`));
            if (!response.ok) return [];
            const data = await response.json();
            const rows = Array.isArray(data.tasks) ? data.tasks : [];
            return rows.map(row => ({
                id: row.id,
                task_name: row.name,
                estimated_minutes: Math.round(Number(row.estimated_ms || 0) / 60000),
                elapsed_ms: Number(row.elapsed_ms || 0),
                status: row.status || 'pending',
                created_at: row.created || Date.now(),
                started_at: row.started || null,
                completed_at: row.completed || null,
                last_changed: row.last_changed || null
            }));
        } catch (error) {
            console.warn('Could not resume the saved task list:', error);
            return [];
        }
    }

    function fixedPromptForUpfrontTimings() {
        document.getElementById('taskCompare')?.classList.add('hidden');
        const container = document.getElementById('dynamicContainer');
        if (!container) return;
        container.innerHTML = '';

        const gatewayScreen = document.createElement('div');
        gatewayScreen.id = 'timingGatewayScreen';

        const question = document.createElement('h2');
        question.textContent = 'Do you want to set timings now?';
        gatewayScreen.appendChild(question);

        const yesButton = document.createElement('button');
        yesButton.textContent = 'Yes';
        yesButton.addEventListener('click', () => runSequentialTimingInput(currentTaskIndex));
        gatewayScreen.appendChild(yesButton);

        const noButton = document.createElement('button');
        noButton.textContent = 'No';
        noButton.addEventListener('click', displaySortedTasks);
        gatewayScreen.appendChild(noButton);

        container.appendChild(gatewayScreen);
        fixedSaveSession();
    }

    function fixedDisplaySpareTime() {
        if (timerInterval) clearInterval(timerInterval);
        document.getElementById('stopWorkingBtn')?.classList.add('hidden');

        const container = document.getElementById('dynamicContainer');
        if (!container) return;
        container.innerHTML = '';

        const completionScreen = document.createElement('div');
        completionScreen.id = 'completionScreen';

        const title = document.createElement('h2');
        title.textContent = 'All Done!';
        completionScreen.appendChild(title);

        const completedTasks = sortedTasks.filter(isTaskCompleted);
        const totalVarianceMs = completedTasks.reduce(
            (total, task) => total + estimateMs(task) - actualMs(task),
            0
        );
        spareTime = Math.round(totalVarianceMs / 1000);

        const remainingDisplay = document.createElement('p');
        remainingDisplay.textContent = `Time Remaining: ${formatSignedDuration(totalVarianceMs)}`;
        remainingDisplay.style.color = totalVarianceMs >= 0 ? 'green' : 'red';
        completionScreen.appendChild(remainingDisplay);

        const breakdownTitle = document.createElement('h3');
        breakdownTitle.textContent = 'How Each Task Went:';
        completionScreen.appendChild(breakdownTitle);

        const reportList = document.createElement('ul');
        completedTasks.forEach(task => {
            const item = document.createElement('li');
            const estimatedMinutes = Math.round(estimateMs(task) / 60000);
            const actualMinutes = Math.round(actualMs(task) / 60000);
            item.textContent = `${task.name} — ${describeTaskTiming(estimatedMinutes, actualMinutes)}`;
            reportList.appendChild(item);
        });
        completionScreen.appendChild(reportList);

        const downloadButton = document.createElement('button');
        downloadButton.textContent = 'Download Files Again (CSV & TXT)';
        downloadButton.addEventListener('click', downloadAllTaskFiles);
        completionScreen.appendChild(downloadButton);

        const resetButton = document.createElement('button');
        resetButton.textContent = 'Start Over';
        resetButton.style.marginLeft = '15px';
        resetButton.addEventListener('click', async () => {
            await clearSession();
            window.location.reload();
        });
        completionScreen.appendChild(resetButton);

        container.appendChild(completionScreen);
        fixedSaveSession();
    }

    function applyOverrides() {
        window.saveSession = fixedSaveSession;
        window.fetchExistingQueue = fixedFetchExistingQueue;
        window.promptForUpfrontTimings = fixedPromptForUpfrontTimings;
        window.displaySpareTime = fixedDisplaySpareTime;
    }

    applyOverrides();
    document.addEventListener('DOMContentLoaded', applyOverrides);
    setTimeout(applyOverrides, 250);
    setTimeout(applyOverrides, 1000);
})();
