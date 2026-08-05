// --- Workflow Bootstrap ---
// The workflow code is temporarily sourced from the preserved baseline while
// the structural split is validated on the live branch. Shared state, helpers,
// and API functions are loaded first by index.html.
(async function loadWorkflowFromBaseline() {
    const marker = '// --- App Initialization & Event Handlers ---';

    function replaceOrThrow(source, searchValue, replacement, label) {
        if (!source.includes(searchValue)) {
            throw new Error(`Unable to apply workflow patch: ${label}`);
        }
        return source.replace(searchValue, replacement);
    }

    function replaceAllOrThrow(source, searchValue, replacement, label) {
        if (!source.includes(searchValue)) {
            throw new Error(`Unable to apply workflow patch: ${label}`);
        }
        return source.split(searchValue).join(replacement);
    }

    // Preserve the original canonical writer, but make failures actionable.
    // This remains outside the evaluated workflow because frontend.js loads first.
    if (typeof saveCanonicalTask === 'function' && !saveCanonicalTask.__diagnosticWrapped) {
        const originalSaveCanonicalTask = saveCanonicalTask;
        const diagnosticSaveCanonicalTask = async function(task, sortOrder, status) {
            try {
                return await originalSaveCanonicalTask(task, sortOrder, status);
            } catch (error) {
                const taskId = task?.id || '(missing id)';
                console.error('Canonical task write failed', {
                    sessionId,
                    taskId,
                    taskName: task?.name,
                    status,
                    sortOrder,
                    error
                });
                throw error;
            }
        };
        diagnosticSaveCanonicalTask.__diagnosticWrapped = true;
        saveCanonicalTask = diagnosticSaveCanonicalTask;
    }

    try {
        const response = await fetch('script.original.js', { cache: 'no-store' });
        if (!response.ok) throw new Error(`Unable to load workflow baseline (${response.status})`);

        const baselineSource = await response.text();
        const workflowStart = baselineSource.indexOf(marker);
        if (workflowStart === -1) throw new Error('Workflow boundary marker was not found in script.original.js');

        let workflowSource = baselineSource.slice(workflowStart);

        // Keep the timer running past zero. It turns red and continues counting
        // negative time until the user explicitly completes the task.
        workflowSource = replaceOrThrow(
            workflowSource,
            `        const absTime = Math.abs(timeRemaining);\n        const minutes = Math.floor(absTime / 60);\n        const seconds = absTime % 60;\n        timerDisplay.textContent = \`Time Remaining: \${timeRemaining >= 0 ? '' : '-'}\${minutes}:\${seconds < 10 ? '0' : ''}\${seconds}\`;\n\n        if (timeRemaining <= 0) {\n            clearInterval(timerInterval);\n            alert(\`Time's up for "\${currentTask.name}"! Let's move on to the next task.\`);\n            finalizeCurrentTaskAndAdvance();\n        }`,
            `        const absTime = Math.abs(timeRemaining);\n        const hours = Math.floor(absTime / 3600);\n        const minutes = Math.floor((absTime % 3600) / 60);\n        const seconds = absTime % 60;\n        const formattedTime = [hours, minutes, seconds]\n            .map(value => String(value).padStart(2, '0'))\n            .join(':');\n\n        timerDisplay.textContent = \`Time Remaining: \${timeRemaining >= 0 ? '' : '-'}\${formattedTime}\`;`,
            'focus timer behavior and formatting'
        );

        workflowSource = replaceOrThrow(
            workflowSource,
            `    spareTimeDisplay.textContent = \`Time Remaining: \${spareTime >= 0 ? '' : '-'}\${hours}:\${minutes < 10 ? '0' : ''}:\${seconds < 10 ? '0' : ''}\${seconds}\`;`,
            `    const formattedSpareTime = [hours, minutes, seconds]\n        .map(value => String(value).padStart(2, '0'))\n        .join(':');\n    spareTimeDisplay.textContent = \`Time Remaining: \${spareTime >= 0 ? '' : '-'}\${formattedSpareTime}\`;`,
            'completion timer formatting'
        );

        // Preserve stable IDs when resuming from canonical tasks.
        workflowSource = replaceOrThrow(
            workflowSource,
            `        sortedTasks = queue.map(q => ({\n            name: q.task_name,\n            estimatedTime: q.estimated_minutes || 0,\n            actualTimeMs: q.elapsed_ms || 0,\n            timestamps: { created: Date.now(), started: null, completed: null }\n        }));\n        currentTaskIndex = 0;`,
            `        sortedTasks = queue.map(q => ({\n            id: q.id || null,\n            name: q.task_name,\n            status: q.status || 'pending',\n            estimatedTime: q.estimated_minutes || 0,\n            actualTimeMs: q.elapsed_ms || 0,\n            timestamps: { created: q.created_at || Date.now(), started: null, completed: null }\n        }));\n        sortedTasks.forEach(ensureTaskId);\n        currentTaskIndex = 0;\n        setActiveTaskFromCurrentIndex();`,
            'canonical resume identity'
        );

        // Import either the completed-task CSV export or the uncompleted-task TXT export.
        const oldImportStart = `// CSV Session Resumption\nfunction handleCSVUpload(event) {`;
        const oldImportEnd = `\n// Upfront Timings Gateway Motif`;
        const importStartIndex = workflowSource.indexOf(oldImportStart);
        const importEndIndex = workflowSource.indexOf(oldImportEnd, importStartIndex);
        if (importStartIndex === -1 || importEndIndex === -1) {
            throw new Error('Unable to apply workflow patch: CSV/TXT importer');
        }

        const importerSource = `// CSV or TXT Session Resumption
function handleCSVUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    const extension = file.name.split('.').pop()?.toLowerCase();
    if (!['csv', 'txt'].includes(extension)) {
        alert('Please choose a CSV or TXT task file.');
        event.target.value = '';
        return;
    }

    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const text = String(e.target.result || '');
            const parsedTasks = extension === 'csv'
                ? parseTasksFromCSV(text)
                : parseTasksFromTXT(text);

            if (parsedTasks.length === 0) {
                alert("We couldn't find any tasks in that file.");
                return;
            }

            if (!sessionStartTimestamp) sessionStartTimestamp = Date.now();
            document.getElementById('timeConstraintInput')?.classList.add('hidden');
            document.getElementById('taskInput')?.classList.add('hidden');

            sortedTasks = parsedTasks;
            currentTaskIndex = parsedTasks.findIndex(task => task.status !== 'completed');
            if (currentTaskIndex === -1) currentTaskIndex = parsedTasks.length;
            setActiveTaskFromCurrentIndex();

            saveSession();
            syncPendingQueueToBackend();
            displaySortedTasks();
            event.target.value = '';
        } catch (error) {
            console.error('Task file import failed:', error);
            alert('That file could not be imported. Check its formatting and try again.');
        }
    };
    reader.onerror = function() {
        alert('The file could not be read.');
    };
    reader.readAsText(file);
}

function createImportedTask(name, estimatedTime = 0, actualMinutes = 0) {
    const completed = actualMinutes > 0;
    const task = {
        name,
        status: completed ? 'completed' : 'pending',
        estimatedTime,
        actualTimeMs: actualMinutes * 60000,
        timestamps: {
            created: Date.now(),
            started: null,
            completed: completed ? Date.now() : null
        }
    };
    ensureTaskId(task);
    return task;
}

function parseTasksFromTXT(text) {
    return text
        .split(/\\r?\\n/)
        .map(line => line.trim())
        .filter(Boolean)
        .filter(line => !/^uncompleted tasks$/i.test(line) && !/^-{3,}$/.test(line))
        .map(line => line.replace(/^\\d+\\.\\s*/, '').trim())
        .filter(Boolean)
        .map(name => createImportedTask(name));
}

function parseTasksFromCSV(text) {
    const lines = text.split(/\\r?\\n/).map(line => line.trim()).filter(Boolean);
    if (lines.length === 0) return [];

    const firstRow = parseCSVRow(lines[0]);
    const hasHeader = firstRow.some(value => /task name|estimated time|actual time/i.test(value));
    const startIndex = hasHeader ? 1 : 0;
    const tasks = [];

    for (let index = startIndex; index < lines.length; index++) {
        const columns = parseCSVRow(lines[index]);
        const name = String(columns[0] || '').trim();
        if (!name) continue;
        const estimatedTime = parseInt(columns[1], 10) || 0;
        const actualMinutes = parseInt(columns[2], 10) || 0;
        tasks.push(createImportedTask(name, estimatedTime, actualMinutes));
    }
    return tasks;
}

function parseCSVRow(row) {
    const values = [];
    let currentValue = '';
    let insideQuotes = false;

    for (let index = 0; index < row.length; index++) {
        const character = row[index];
        if (character === '"') {
            if (insideQuotes && row[index + 1] === '"') {
                currentValue += '"';
                index++;
            } else {
                insideQuotes = !insideQuotes;
            }
        } else if (character === ',' && !insideQuotes) {
            values.push(currentValue);
            currentValue = '';
        } else {
            currentValue += character;
        }
    }
    values.push(currentValue);
    return values;
}
`;
        workflowSource = workflowSource.slice(0, importStartIndex)
            + importerSource
            + workflowSource.slice(importEndIndex);

        // When inserting at the current slot, the new task becomes active before
        // any save. Otherwise activeTaskId would pull the index back to the old task.
        workflowSource = replaceOrThrow(
            workflowSource,
            `        const arrayInsertionIndex = targetSlot - 1; \n\n        sortedTasks.splice(arrayInsertionIndex, 0, newTaskObj);\n        syncPendingQueueToBackend();\n        \n        // If user inserted the new task as current top priority, prompt for time estimate immediately\n        if (arrayInsertionIndex === currentTaskIndex) {\n            promptTimingForNewActiveTask(currentTaskIndex);\n        } else {\n            displaySortedTasks();\n        }`,
            `        ensureTaskId(newTaskObj);\n        const arrayInsertionIndex = targetSlot - 1;\n        sortedTasks.splice(arrayInsertionIndex, 0, newTaskObj);\n\n        if (arrayInsertionIndex === currentTaskIndex) {\n            setActiveTask(newTaskObj);\n            syncPendingQueueToBackend();\n            promptTimingForNewActiveTask(currentTaskIndex);\n        } else {\n            syncPendingQueueToBackend();\n            displaySortedTasks();\n        }`,
            'current-slot task insertion'
        );

        // Ending a session pauses the active task; it must not silently complete it.
        workflowSource = replaceOrThrow(
            workflowSource,
            `    if (document.getElementById('focusScreen') && currentTaskIndex < sortedTasks.length) {\n        const nowMs = Date.now();\n        const nowSec = Math.floor(nowMs / 1000);\n        const task = sortedTasks[currentTaskIndex];\n        \n        const actualElapsedMs = nowMs - (task.timestamps?.lastStarted || (taskStartTimestamp * 1000));\n        task.actualTimeMs = (task.actualTimeMs || 0) + actualElapsedMs;\n        task.timestamps.completed = nowMs;\n        spareTime += (deadline - nowSec);\n        \n        logTaskCompletionToBackend(task);\n        currentTaskIndex++;\n    }`,
            `    if (document.getElementById('focusScreen') && currentTaskIndex < sortedTasks.length) {\n        const nowMs = Date.now();\n        const nowSec = Math.floor(nowMs / 1000);\n        const task = sortedTasks[currentTaskIndex];\n\n        const actualElapsedMs = nowMs - (task.timestamps?.lastStarted || (taskStartTimestamp * 1000));\n        task.actualTimeMs = (task.actualTimeMs || 0) + Math.max(0, actualElapsedMs);\n        pausedSecondsRemaining = deadline - nowSec;\n        task.status = 'active';\n        task.timestamps.lastStarted = null;\n        setActiveTask(task);\n        await syncPendingQueueToBackend();\n    }`,
            'end-session pause behavior'
        );

        // End-session reporting must distinguish work that is actually complete
        // from active or pending tasks. The old report described every row as finished.
        workflowSource = replaceOrThrow(
            workflowSource,
            `    const breakdownTitle = document.createElement('h3');\n    breakdownTitle.textContent = 'How Each Task Went:';\n    completionScreen.appendChild(breakdownTitle);\n\n    const reportList = document.createElement('ul');\n    sortedTasks.forEach(task => {\n        const item = document.createElement('li');\n        const actualMinutes = getActualMinutes(task);\n        item.textContent = \`\${task.name} — \${describeTaskTiming(task.estimatedTime, actualMinutes)}\`;\n        reportList.appendChild(item);\n    });\n    completionScreen.appendChild(reportList);`,
            `    const completedTasks = sortedTasks.filter(task => task.status === 'completed' || Boolean(task.timestamps?.completed));\n    const remainingTasks = sortedTasks.filter(task => task.status !== 'completed' && !task.timestamps?.completed);\n\n    if (completedTasks.length > 0) {\n        const breakdownTitle = document.createElement('h3');\n        breakdownTitle.textContent = 'Completed Tasks:';\n        completionScreen.appendChild(breakdownTitle);\n\n        const reportList = document.createElement('ul');\n        completedTasks.forEach(task => {\n            const item = document.createElement('li');\n            const actualMinutes = getActualMinutes(task);\n            item.textContent = \`\${task.name} — \${describeTaskTiming(task.estimatedTime, actualMinutes)}\`;\n            reportList.appendChild(item);\n        });\n        completionScreen.appendChild(reportList);\n    }\n\n    if (remainingTasks.length > 0) {\n        const remainingTitle = document.createElement('h3');\n        remainingTitle.textContent = 'Remaining Tasks:';\n        completionScreen.appendChild(remainingTitle);\n\n        const remainingList = document.createElement('ul');\n        remainingTasks.forEach(task => {\n            const item = document.createElement('li');\n            const label = task.status === 'blocked' ? 'Blocked' : task.status === 'active' ? 'In progress' : 'Not completed';\n            item.textContent = \`\${task.name} — \${label}\`;\n            remainingList.appendChild(item);\n        });\n        completionScreen.appendChild(remainingList);\n    }`,
            'truthful end-session reporting'
        );

        // The legacy workflow still advances an index; immediately derive the
        // authoritative activeTaskId after each true completion.
        workflowSource = replaceAllOrThrow(
            workflowSource,
            `        currentTaskIndex++;`,
            `        currentTaskIndex++;\n        setActiveTaskFromCurrentIndex();`,
            'task advancement identity synchronization'
        );

        workflowSource = replaceOrThrow(
            workflowSource,
            `        currentTaskIndex = originallyCompleted.length + newlyCompleted.length;\n\n        saveSession();`,
            `        currentTaskIndex = originallyCompleted.length + newlyCompleted.length;\n        setActiveTaskFromCurrentIndex();\n\n        saveSession();`,
            'checklist active task synchronization'
        );

        (0, eval)(`${workflowSource}\n//# sourceURL=task-sorter-workflow.js`);
    } catch (error) {
        console.error('Task Sorter workflow failed to initialize:', error);
        const container = document.getElementById('dynamicContainer');
        if (container) {
            container.innerHTML = '';
            const message = document.createElement('p');
            message.textContent = 'Task Sorter could not start. Refresh the page and try again.';
            message.style.color = '#b71c1c';
            message.style.fontWeight = 'bold';
            container.appendChild(message);
        }
    }
})();
