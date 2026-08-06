// Targeted regression fixes for chatgpt-2.
(function installRegressionFixes() {
    const TEN_MINUTES_MS = 10 * 60 * 1000;

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

    function normalizeTaskTiming(task) {
        if (!task || typeof task !== 'object') return task;
        ensureTaskId(task);
        task.estimatedTimeMs = estimateMs(task);
        task.estimatedTime = Math.round(task.estimatedTimeMs / 60000);
        task.actualTimeMs = actualMs(task);
        if (!task.timestamps) task.timestamps = {};
        task.created = Number(task.created ?? task.timestamps.created ?? Date.now());
        task.started = task.started ?? task.timestamps.started ?? null;
        task.completedTime = task.completedTime ?? task.timestamps.completed ?? null;
        task.lastChanged = task.lastChanged ?? null;
        task.completed = isTaskCompleted(task);
        task.status = task.completed ? 'completed' : (task.status || 'pending');
        task.timestamps.created = task.created;
        task.timestamps.started = task.started;
        task.timestamps.completed = task.completedTime;
        return task;
    }

    function calculateAllocatedTimeMs() {
        return sortedTasks
            .filter(task => !isTaskCompleted(task))
            .reduce((total, task) => {
                const taskEstimate = estimateMs(task);
                return total + (taskEstimate > 0 ? taskEstimate : TEN_MINUTES_MS);
            }, 0);
    }

    function saveLocalSnapshot() {
        sortedTasks.forEach(normalizeTaskTiming);
        const firstIncompleteIndex = sortedTasks.findIndex(task => !isTaskCompleted(task));
        currentTaskIndex = firstIncompleteIndex === -1 ? sortedTasks.length : firstIncompleteIndex;
        activeTaskId = sortedTasks[currentTaskIndex]?.id || null;

        const snapshot = {
            sortedTasks,
            activeTaskId,
            currentTaskIndex,
            spareTime,
            totalAvailableTime,
            allocatedTimeMs: calculateAllocatedTimeMs(),
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

    function rowToTask(row) {
        return normalizeTaskTiming({
            id: row.id,
            name: row.name,
            status: row.status || 'pending',
            completed: false,
            estimatedTimeMs: Number(row.estimated_ms || 0),
            actualTimeMs: Number(row.elapsed_ms || 0),
            projectId: row.project_id || null,
            blockedByTaskId: row.blocked_by_task_id || null,
            created: Number(row.created || Date.now()),
            started: row.started ?? null,
            completedTime: null,
            lastChanged: row.last_changed ?? null,
            timestamps: {
                created: Number(row.created || Date.now()),
                started: row.started ?? null,
                completed: null
            }
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
                estimated_ms: Number(row.estimated_ms || 0),
                elapsed_ms: Number(row.elapsed_ms || 0),
                status: row.status || 'pending',
                created_at: row.created || Date.now(),
                started_at: row.started || null,
                completed_at: null,
                last_changed: row.last_changed || null
            }));
        } catch (error) {
            console.warn('Could not resume the saved task list:', error);
            return [];
        }
    }

    function fixedPromptForUpfrontTimings() {
        document.getElementById('taskInput')?.classList.add('hidden');
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
        yesButton.addEventListener('click', () => fixedRunSequentialTimingInput(0));
        gatewayScreen.appendChild(yesButton);

        const noButton = document.createElement('button');
        noButton.textContent = 'No';
        noButton.addEventListener('click', () => {
            container.innerHTML = '';
            displaySortedTasks();
        });
        gatewayScreen.appendChild(noButton);

        container.appendChild(gatewayScreen);
        fixedSaveSession();
    }

    function fixedRunSequentialTimingInput(startIndex = 0) {
        sortedTasks.forEach(normalizeTaskTiming);
        let index = Math.max(0, Number(startIndex) || 0);

        while (index < sortedTasks.length && isTaskCompleted(sortedTasks[index])) index++;

        const container = document.getElementById('dynamicContainer');
        if (!container) return;
        container.innerHTML = '';
        document.getElementById('taskInput')?.classList.add('hidden');
        document.getElementById('taskCompare')?.classList.add('hidden');

        if (index >= sortedTasks.length) {
            displaySortedTasks();
            fixedSaveSession();
            return;
        }

        const task = sortedTasks[index];
        const screen = document.createElement('div');
        screen.id = 'timingEntryScreen';

        const heading = document.createElement('h2');
        heading.append('How many minutes should you spend on: ');
        const strong = document.createElement('strong');
        strong.textContent = task.name;
        heading.appendChild(strong);
        screen.appendChild(heading);

        const input = document.createElement('input');
        input.type = 'number';
        input.min = '1';
        input.max = String(MAX_TASK_MINUTES);
        input.placeholder = `Enter minutes (1-${MAX_TASK_MINUTES})`;
        if (task.estimatedTimeMs > 0) input.value = String(Math.round(task.estimatedTimeMs / 60000));
        screen.appendChild(input);

        const nextButton = document.createElement('button');
        nextButton.textContent = index === sortedTasks.length - 1 ? 'Finish Timings' : 'Next';
        nextButton.addEventListener('click', () => {
            const minutes = Number.parseInt(input.value, 10);
            if (!Number.isFinite(minutes) || minutes < 1 || minutes > MAX_TASK_MINUTES) {
                alert(`Please pick a number between 1 and ${MAX_TASK_MINUTES} minutes.`);
                return;
            }

            task.estimatedTimeMs = minutes * 60000;
            task.estimatedTime = minutes;
            fixedSaveSession();
            fixedRunSequentialTimingInput(index + 1);
        });
        screen.appendChild(nextButton);

        container.appendChild(screen);
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

    function installResumeHandler() {
        const original = document.getElementById('resumeExistingListBtn');
        if (!original || original.dataset.canonicalResumeInstalled === 'true') return;

        const replacement = original.cloneNode(true);
        replacement.dataset.canonicalResumeInstalled = 'true';
        original.replaceWith(replacement);

        replacement.addEventListener('click', async () => {
            replacement.disabled = true;
            try {
                const response = await fetch(apiUrl(`/api/session/${sessionId}/tasks?incomplete=1`));
                if (!response.ok) throw new Error(`Resume failed (${response.status})`);
                const data = await response.json();
                const rows = Array.isArray(data.tasks) ? data.tasks : [];

                if (rows.length === 0) {
                    alert('No saved incomplete tasks were found for this session.');
                    return;
                }

                sortedTasks = rows.map(rowToTask);
                currentTaskIndex = 0;
                activeTaskId = sortedTasks[0]?.id || null;

                document.getElementById('modeSelect')?.classList.add('hidden');
                document.getElementById('workChoiceStep')?.classList.add('hidden');
                document.getElementById('timeConstraintInput')?.classList.add('hidden');
                document.getElementById('taskInput')?.classList.add('hidden');
                document.getElementById('taskCompare')?.classList.add('hidden');
                document.getElementById('dynamicContainer').innerHTML = '';

                saveLocalSnapshot();
                displaySortedTasks();
            } catch (error) {
                console.warn('Resume Existing List failed:', error);
                alert('The saved task list could not be loaded.');
            } finally {
                replacement.disabled = false;
            }
        });
    }

    function installUploadRoutingFix() {
        const input = document.getElementById('csvUpload');
        if (!input || input.dataset.regressionUploadInstalled === 'true') return;

        const replacement = input.cloneNode(true);
        replacement.dataset.regressionUploadInstalled = 'true';
        input.replaceWith(replacement);

        replacement.addEventListener('change', event => {
            const file = event.target.files?.[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = loadEvent => {
                try {
                    const text = String(loadEvent.target.result || '').trim();
                    if (!text) return;

                    const rows = typeof Papa !== 'undefined' && typeof Papa.parse === 'function'
                        ? Papa.parse(text, { skipEmptyLines: true }).data
                        : text.split(/\r?\n/).filter(Boolean).map(line => [line]);

                    const headers = (rows[0] || []).map(value => String(value).trim().toLowerCase());
                    const nameIndex = headers.findIndex(header => /^(task name|task|name|title|reminder)$/.test(header));
                    const idIndex = headers.findIndex(header => /^(task id|id)$/.test(header));
                    const estimatedIndex = headers.findIndex(header => header.includes('estimated'));
                    const actualIndex = headers.findIndex(header => header.includes('actual'));
                    const completedIndex = headers.findIndex(header => /^(completed|done|status)$/.test(header));
                    const structured = nameIndex >= 0;

                    if (structured) {
                        sortedTasks = rows.slice(1).map(row => normalizeTaskTiming({
                            id: idIndex >= 0 ? String(row[idIndex] || '').trim() || undefined : undefined,
                            name: String(row[nameIndex] || '').trim(),
                            estimatedTimeMs: estimatedIndex >= 0 ? (Number(row[estimatedIndex]) || 0) * 60000 : 0,
                            actualTimeMs: actualIndex >= 0 ? (Number(row[actualIndex]) || 0) * 60000 : 0,
                            completed: completedIndex >= 0 && ['true', 'yes', '1', 'completed', 'done'].includes(String(row[completedIndex] || '').trim().toLowerCase()),
                            created: Date.now(),
                            timestamps: { created: Date.now(), started: null, completed: null }
                        })).filter(task => task.name);
                    } else {
                        const taskNames = text.includes('\n')
                            ? text.split(/\r?\n/)
                            : text.split(',');
                        sortedTasks = taskNames
                            .map(name => String(name).replace(/^\s*\d+[.)]\s*/, '').trim())
                            .filter(name => name && !/^uncompleted tasks$/i.test(name) && !/^-{3,}$/.test(name))
                            .map(name => normalizeTaskTiming({
                                name,
                                estimatedTimeMs: 0,
                                actualTimeMs: 0,
                                completed: false,
                                created: Date.now(),
                                timestamps: { created: Date.now(), started: null, completed: null }
                            }));
                    }

                    if (!sortedTasks.length) {
                        alert("We couldn't find any tasks in that file.");
                        return;
                    }

                    currentTaskIndex = sortedTasks.findIndex(task => !isTaskCompleted(task));
                    if (currentTaskIndex < 0) currentTaskIndex = sortedTasks.length;
                    activeTaskId = sortedTasks[currentTaskIndex]?.id || null;

                    document.getElementById('taskInput')?.classList.add('hidden');
                    document.getElementById('taskCompare')?.classList.add('hidden');
                    document.getElementById('dynamicContainer').innerHTML = '';
                    replacement.value = '';
                    saveLocalSnapshot();

                    const hasImportedIds = structured && idIndex >= 0 && sortedTasks.every(task => task.id);
                    if (hasImportedIds) displaySortedTasks();
                    else fixedPromptForUpfrontTimings();
                } catch (error) {
                    console.warn('Task import failed:', error);
                    alert('That task file could not be imported.');
                }
            };
            reader.onerror = () => console.warn('Task import file could not be read.');
            reader.readAsText(file);
        });
    }

    function applyOverrides() {
        window.saveSession = fixedSaveSession;
        window.fetchExistingQueue = fixedFetchExistingQueue;
        window.promptForUpfrontTimings = fixedPromptForUpfrontTimings;
        window.runSequentialTimingInput = fixedRunSequentialTimingInput;
        window.displaySpareTime = fixedDisplaySpareTime;
        window.getTotalAllocatedTime = function getTotalAllocatedTime() {
            return calculateAllocatedTimeMs() / 60000;
        };
        installResumeHandler();
        installUploadRoutingFix();
    }

    applyOverrides();
    document.addEventListener('DOMContentLoaded', applyOverrides);
    setTimeout(applyOverrides, 250);
    setTimeout(applyOverrides, 1000);
})();
