'use strict';

// Project Planner now owns its backend reads/writes through the canonical
// task-node API. The bridge only connects the Task Sorter mode selector to it.
const planButton = document.getElementById('planBtn');
if (planButton) {
    planButton.disabled = false;
    planButton.onclick = () => window.ProjectPlanner?.open();
}
