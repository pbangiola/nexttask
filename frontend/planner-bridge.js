'use strict';

// Narrow integration seam between the existing Work engine and Project Planner.
// The Work code keeps ownership of its task state; Planner gets a live read-only
// view for backlog discovery.
try {
    if (!Object.prototype.hasOwnProperty.call(window, 'sortedTasks')) {
        Object.defineProperty(window, 'sortedTasks', {
            configurable: true,
            get: () => sortedTasks
        });
    }
} catch (error) {
    console.warn('Could not expose Task Sorter backlog to Project Planner:', error);
}

const planButton = document.getElementById('planBtn');
if (planButton) {
    planButton.disabled = false;
    planButton.onclick = () => window.ProjectPlanner?.open();
}
