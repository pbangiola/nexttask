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

    try {
        const response = await fetch('script.original.js', { cache: 'no-store' });
        if (!response.ok) {
            throw new Error(`Unable to load workflow baseline (${response.status})`);
        }

        const baselineSource = await response.text();
        const workflowStart = baselineSource.indexOf(marker);

        if (workflowStart === -1) {
            throw new Error('Workflow boundary marker was not found in script.original.js');
        }

        let workflowSource = baselineSource.slice(workflowStart);

        // Keep the timer running past zero. It simply turns red and continues
        // counting negative time until the user explicitly completes the task.
        workflowSource = replaceOrThrow(
            workflowSource,
            `        const absTime = Math.abs(timeRemaining);\n        const minutes = Math.floor(absTime / 60);\n        const seconds = absTime % 60;\n        timerDisplay.textContent = \`Time Remaining: \${timeRemaining >= 0 ? '' : '-'}\${minutes}:\${seconds < 10 ? '0' : ''}\${seconds}\`;\n\n        if (timeRemaining <= 0) {\n            clearInterval(timerInterval);\n            alert(\`Time's up for "\${currentTask.name}"! Let's move on to the next task.\`);\n            finalizeCurrentTaskAndAdvance();\n        }`,
            `        const absTime = Math.abs(timeRemaining);\n        const hours = Math.floor(absTime / 3600);\n        const minutes = Math.floor((absTime % 3600) / 60);\n        const seconds = absTime % 60;\n        const formattedTime = [hours, minutes, seconds]\n            .map(value => String(value).padStart(2, '0'))\n            .join(':');\n\n        timerDisplay.textContent = \`Time Remaining: \${timeRemaining >= 0 ? '' : '-'}\${formattedTime}\`;`,
            'focus timer behavior and formatting'
        );

        // Use the same HH:MM:SS formatting on the completion summary.
        workflowSource = replaceOrThrow(
            workflowSource,
            `    spareTimeDisplay.textContent = \`Time Remaining: \${spareTime >= 0 ? '' : '-'}\${hours}:\${minutes < 10 ? '0' : ''}:\${seconds < 10 ? '0' : ''}\${seconds}\`;`,
            `    const formattedSpareTime = [hours, minutes, seconds]\n        .map(value => String(value).padStart(2, '0'))\n        .join(':');\n    spareTimeDisplay.textContent = \`Time Remaining: \${spareTime >= 0 ? '' : '-'}\${formattedSpareTime}\`;`,
            'completion timer formatting'
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
