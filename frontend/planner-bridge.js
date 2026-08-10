'use strict';

// Narrow integration seam between the existing Work engine and Project Planner.
// Work keeps ownership of its in-memory task state. Planner gets a separate
// read-only backlog snapshot, refreshed from the user's canonical backend queue
// each time Plan is opened.
let plannerBacklogSnapshot = null;

try {
    if (!Object.prototype.hasOwnProperty.call(window, 'sortedTasks')) {
        Object.defineProperty(window, 'sortedTasks', {
            configurable: true,
            get: () => plannerBacklogSnapshot || sortedTasks
        });
    }
} catch (error) {
    console.warn('Could not expose Task Sorter backlog to Project Planner:', error);
}

async function loadPlannerBacklogFromBackend() {
    try {
        const response = await fetch(`${API_BASE_URL}/api/users/${encodeURIComponent(userId)}/tasks`);
        if (!response.ok) throw new Error(`Backlog request failed (${response.status})`);

        const data = await response.json();
        const tasks = Array.isArray(data.tasks) ? data.tasks : [];

        plannerBacklogSnapshot = tasks.map(task => ({
            id: task.id,
            name: task.name,
            status: task.status || 'pending',
            completed: task.status === 'completed' || Boolean(task.completed_time)
        }));
    } catch (error) {
        console.warn('Could not refresh Planner backlog from backend; using current browser task list:', error);
        plannerBacklogSnapshot = null;
    }
}

const planButton = document.getElementById('planBtn');
if (planButton) {
    planButton.disabled = false;
    planButton.onclick = async () => {
        await loadPlannerBacklogFromBackend();
        window.ProjectPlanner?.open();
    };
}
