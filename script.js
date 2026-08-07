// --- Project Planner State & Local Persistence ---
const PROJECT_PLANNER_STATE_KEY = 'projectPlannerState';

let sortedTasks = [];
let currentProjectContext = null;

function saveSession() {
    const sessionState = {
        sortedTasks,
        currentProjectContext,
        activeView: getActiveViewContext()
    };
    localStorage.setItem(PROJECT_PLANNER_STATE_KEY, JSON.stringify(sessionState));
}

function loadSession() {
    const saved = localStorage.getItem(PROJECT_PLANNER_STATE_KEY);
    initInitialListeners();
    if (!saved) return;

    try {
        const state = JSON.parse(saved);
        sortedTasks = Array.isArray(state.sortedTasks) ? state.sortedTasks : [];
        currentProjectContext = state.currentProjectContext || null;
        routeToStoredView(state.activeView);
    } catch (error) {
        console.warn('Saved Project Planner session could not be restored.', error);
    }
}

function clearSession() {
    localStorage.removeItem(PROJECT_PLANNER_STATE_KEY);
    sortedTasks = [];
    currentProjectContext = null;
}

function getActiveViewContext() {
    if (document.getElementById('projectBuilderPanel')) return 'project-wizard';
    if (document.getElementById('dashboardScreen')) return 'dashboard';
    if (document.getElementById('timingGatewayScreen')) return 'timing-gateway';
    if (document.getElementById('timingEntryScreen')) return 'timing-entry';
    return 'landing';
}

function routeToStoredView(view) {
    if (!view || view === 'landing') return;

    document.getElementById('taskInputContainer').classList.add('hidden');

    if (view === 'project-wizard') resumeProjectWizard();
    else if (view === 'timing-gateway') runUpfrontTimingGateway();
    else if (view === 'timing-entry') runSequentialTimingLoop(findFirstUntimedTask());
    else displaySortedTasks();
}

// --- Project Planner Entry & Import ---
function initInitialListeners() {
    const submitBtn = document.getElementById('btnSubmitText');
    const fileInput = document.getElementById('csvFileInput');

    if (submitBtn) {
        submitBtn.onclick = () => {
            const input = document.getElementById('tasksTextarea').value.trim();
            if (!input) {
                alert('Please enter at least one task to get started.');
                return;
            }

            const items = input.split('\n').map(task => task.trim()).filter(Boolean);
            const skip = document.getElementById('skipSortCheckbox').checked;
            document.getElementById('taskInputContainer').classList.add('hidden');

            if (skip || items.length <= 1) {
                sortedTasks = items.map(name => ({ name, estimatedTime: 0 }));
                runUpfrontTimingGateway();
            } else {
                startMergeSort(items);
            }
        };
    }

    if (fileInput) {
        fileInput.onchange = event => {
            const file = event.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = loadEvent => {
                const lines = loadEvent.target.result.split('\n').map(line => line.trim()).filter(Boolean);
                const items = [];

                for (let i = 1; i < lines.length; i++) {
                    const parts = lines[i].match(/(".*?"|[^,]+)(?=\s*,|\s*$|\s*\n)/g);
                    if (!parts || parts.length < 1) continue;

                    const name = parts[0].replace(/^"|"$/g, '').trim();
                    const estimatedTime = parseInt(parts[1], 10) || 0;
                    items.push({ name, estimatedTime });
                }

                if (!items.length) {
                    alert("Couldn't find any valid task rows in that file.");
                    return;
                }

                document.getElementById('taskInputContainer').classList.add('hidden');
                sortedTasks = items;
                displaySortedTasks();
            };
            reader.readAsText(file);
        };
    }
}

function showTaskInputPage() {
    document.getElementById('dynamicContainer').innerHTML = '';
    document.getElementById('taskCompare').classList.add('hidden');
    document.getElementById('taskInputContainer').classList.remove('hidden');
}

// --- Project Planner Timing ---
function runUpfrontTimingGateway() {
    const container = document.getElementById('dynamicContainer');
    container.innerHTML = `
        <div id="timingGatewayScreen">
            <h2>Project Planner: Set Task Times</h2>
            <p>Would you like to estimate task durations now, or jump straight to your plan?</p>
            <div class="choice-box-container">
                <div id="gateYes" class="forced-choice-box">Set Times Now</div>
                <div id="gateNo" class="forced-choice-box">Skip and Open Plan</div>
            </div>
        </div>
    `;

    document.getElementById('gateYes').onclick = () => runSequentialTimingLoop(0);
    document.getElementById('gateNo').onclick = displaySortedTasks;
    saveSession();
}

function findFirstUntimedTask() {
    const index = sortedTasks.findIndex(task => !task.estimatedTime);
    return index < 0 ? sortedTasks.length : index;
}

function runSequentialTimingLoop(index) {
    if (index >= sortedTasks.length) {
        displaySortedTasks();
        return;
    }

    const target = sortedTasks[index];
    const container = document.getElementById('dynamicContainer');
    container.innerHTML = `
        <div id="timingEntryScreen">
            <h2>Project Planner: Estimate Task Time</h2>
            <p>Task ${index + 1} of ${sortedTasks.length}: <strong>${target.name}</strong></p>
            <input type="number" id="timingValInput" placeholder="Minutes (1-20)" min="1" max="20">
            <div class="choice-box-container">
                <div id="btnCommitTime" class="forced-choice-box">Save Estimate</div>
            </div>
        </div>
    `;

    document.getElementById('btnCommitTime').onclick = () => {
        const value = parseInt(document.getElementById('timingValInput').value, 10);
        if (isNaN(value) || value < 1 || value > 20) {
            alert('Please pick a time between 1 and 20 minutes.');
            return;
        }

        target.estimatedTime = value;
        saveSession();

        if (value > 15) initiateProjectWizard(index);
        else runSequentialTimingLoop(index + 1);
    };

    saveSession();
}

// --- Project Decomposition Wizard ---
function initiateProjectWizard(parentIndex) {
    currentProjectContext = {
        parentIndex,
        parentName: sortedTasks[parentIndex].name,
        subTaskObjects: [],
        subIndex: 0,
        step: 'subtask-input'
    };
    renderProjectWizardScreen();
}

function resumeProjectWizard() {
    if (!currentProjectContext) {
        displaySortedTasks();
        return;
    }
    renderProjectWizardScreen();
}

function renderProjectWizardScreen() {
    const container = document.getElementById('dynamicContainer');

    if (currentProjectContext.step === 'subtask-input') {
        container.innerHTML = `
            <div id="projectBuilderPanel">
                <h2>Project Planner: Project Detected</h2>
                <p><strong>${currentProjectContext.parentName}</strong> is estimated at more than 15 minutes.</p>
                <div class="choice-box-container">
                    <div id="projKeepSingle" class="forced-choice-box">Keep as a Single Task</div>
                    <div id="projDeconstruct" class="forced-choice-box">Break into Sub-tasks</div>
                </div>
            </div>
        `;

        document.getElementById('projKeepSingle').onclick = () => {
            const nextIndex = currentProjectContext.parentIndex + 1;
            currentProjectContext = null;
            saveSession();
            runSequentialTimingLoop(nextIndex);
        };

        document.getElementById('projDeconstruct').onclick = () => {
            currentProjectContext.step = 'enter-subtasks';
            saveSession();
            renderProjectWizardScreen();
        };
    } else if (currentProjectContext.step === 'enter-subtasks') {
        container.innerHTML = `
            <div id="projectBuilderPanel">
                <h2>Project Planner: Add Sub-tasks</h2>
                <p>Project: <strong>${currentProjectContext.parentName}</strong></p>
                <textarea id="subtaskTextarea" rows="6" placeholder="Enter sub-tasks (one per line)..."></textarea>
                <div class="choice-box-container">
                    <div id="subtaskSubmit" class="forced-choice-box">Add Sub-tasks</div>
                </div>
            </div>
        `;

        document.getElementById('subtaskSubmit').onclick = () => {
            const input = document.getElementById('subtaskTextarea').value.trim();
            if (!input) {
                alert('Please enter at least one sub-task.');
                return;
            }

            currentProjectContext.subTaskObjects = input
                .split('\n')
                .map(task => task.trim())
                .filter(Boolean)
                .map(name => ({ name, estimatedTime: 0 }));

            currentProjectContext.subIndex = 0;
            currentProjectContext.step = 'timing-subtasks';
            saveSession();
            renderProjectWizardScreen();
        };
    } else if (currentProjectContext.step === 'timing-subtasks') {
        const index = currentProjectContext.subIndex;
        const subTasks = currentProjectContext.subTaskObjects;

        if (index >= subTasks.length) {
            finalizeProjectFlattening(currentProjectContext.parentName);
            return;
        }

        const targetSub = subTasks[index];
        container.innerHTML = `
            <div id="projectBuilderPanel">
                <h2>Project Planner: Estimate Sub-task</h2>
                <p>Sub-task ${index + 1} of ${subTasks.length}: <strong>${targetSub.name}</strong></p>
                <input type="number" id="subTimingInput" placeholder="Minutes (1-20)" min="1" max="20">
                <div class="choice-box-container">
                    <div id="subTimingSubmit" class="forced-choice-box">Save Sub-task Estimate</div>
                </div>
            </div>
        `;

        document.getElementById('subTimingSubmit').onclick = () => {
            const value = parseInt(document.getElementById('subTimingInput').value, 10);
            if (isNaN(value) || value < 1 || value > 20) {
                alert('Please enter a value between 1 and 20 minutes.');
                return;
            }

            targetSub.estimatedTime = value;
            if (value > 15) targetSub.name = `${currentProjectContext.parentName}:${targetSub.name}`;
            currentProjectContext.subIndex++;
            saveSession();
            renderProjectWizardScreen();
        };
    }

    saveSession();
}

function finalizeProjectFlattening(finalProjectTitle) {
    const parentIndex = currentProjectContext.parentIndex;
    const children = currentProjectContext.subTaskObjects.map(subTask => ({
        name: subTask.name.startsWith(finalProjectTitle)
            ? subTask.name
            : `${finalProjectTitle}:${subTask.name}`,
        estimatedTime: subTask.estimatedTime
    }));

    sortedTasks.splice(parentIndex, 1, ...children);
    const resumeIndex = parentIndex + children.length;
    currentProjectContext = null;
    saveSession();
    runSequentialTimingLoop(resumeIndex);
}

// --- Project Planner Dashboard ---
function displaySortedTasks() {
    document.getElementById('taskInputContainer').classList.add('hidden');
    document.getElementById('taskCompare').classList.add('hidden');

    const container = document.getElementById('dynamicContainer');
    container.innerHTML = `<div id="dashboardScreen"><h2>Project Planner: Your Plan</h2></div>`;

    const view = document.getElementById('dashboardScreen');
    const total = sortedTasks.reduce((sum, task) => sum + (task.estimatedTime || 0), 0);

    const duration = document.createElement('h3');
    duration.textContent = `Total Estimated Duration: ${total} Minutes`;
    view.appendChild(duration);

    const list = document.createElement('ol');
    sortedTasks.forEach(task => {
        const item = document.createElement('li');
        item.textContent = `${task.name}${task.estimatedTime ? ` — ${task.estimatedTime} min` : ''}`;
        list.appendChild(item);
    });
    view.appendChild(list);

    const controls = document.createElement('div');
    controls.className = 'choice-box-container';

    const exportButton = document.createElement('div');
    exportButton.className = 'forced-choice-box';
    exportButton.textContent = 'Download Project Plan';
    exportButton.onclick = downloadTaskList;

    const restartButton = document.createElement('div');
    restartButton.className = 'forced-choice-box';
    restartButton.textContent = 'Start a New Plan';
    restartButton.onclick = () => {
        if (confirm('Reset this project plan and create a new one?')) {
            clearSession();
            showTaskInputPage();
        }
    };

    controls.append(exportButton, restartButton);
    view.appendChild(controls);
    saveSession();
}

function downloadTaskList() {
    const rows = [
        'Task,Estimated Minutes',
        ...sortedTasks.map(task => `"${String(task.name).replace(/"/g, '""')}",${task.estimatedTime || 0}`)
    ];

    const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'project-plan.csv';
    anchor.click();
    URL.revokeObjectURL(url);
}

// --- Interactive Priority Sort ---
function startMergeSort(array) {
    mergeSortInteractive(array).then(result => {
        sortedTasks = result.map(name => ({ name, estimatedTime: 0 }));
        runUpfrontTimingGateway();
    });
}

async function mergeSortInteractive(array) {
    if (array.length <= 1) return array;

    const midpoint = Math.floor(array.length / 2);
    const left = await mergeSortInteractive(array.slice(0, midpoint));
    const right = await mergeSortInteractive(array.slice(midpoint));
    return mergeInteractive(left, right);
}

function mergeInteractive(left, right) {
    return new Promise(resolve => {
        const result = [];

        function step() {
            if (!left.length || !right.length) {
                document.getElementById('taskCompare').classList.add('hidden');
                resolve([...result, ...left, ...right]);
                return;
            }

            document.getElementById('taskCompare').classList.remove('hidden');
            document.getElementById('task1').textContent = left[0];
            document.getElementById('task2').textContent = right[0];
            document.getElementById('task1').onclick = () => {
                result.push(left.shift());
                step();
            };
            document.getElementById('task2').onclick = () => {
                result.push(right.shift());
                step();
            };
        }

        step();
    });
}

window.addEventListener('DOMContentLoaded', loadSession);
