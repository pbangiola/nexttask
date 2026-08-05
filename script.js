// --- Workflow Bootstrap ---
// The workflow code is temporarily sourced from the preserved baseline while
// the structural split is validated on the live branch. Shared state, helpers,
// and API functions are loaded first by index.html.
(async function loadWorkflowFromBaseline() {
    const marker = '// --- App Initialization & Event Handlers ---';

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

        const workflowSource = baselineSource.slice(workflowStart);
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
