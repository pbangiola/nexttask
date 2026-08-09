// --- Project Planner: browser-only planning prototype ---
const PROJECT_PLANNER_STATE_KEY = 'projectPlannerState';
const AUTO_SUBPROJECT_THRESHOLD_MINUTES = 20;

let project = null;
let currentView = 'home';
let activeScopePath = [];
let activeTaskId = null;
let pendingHasParts = false;

function makeId(prefix = 'item') {
    return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function createTask(name) {
    return {
        id: makeId('task'),
        name: String(name || '').trim(),
        estimatedMinutes: null,
        children: [],
        isProject: false,
        decompositionReviewed: false
    };
}

function saveSession() {
    localStorage.setItem(PROJECT_PLANNER_STATE_KEY, JSON.stringify({
        project,
        currentView,
        activeScopePath,
        activeTaskId,
        pendingHasParts
    }));
}

function loadSession() {
    const saved = localStorage.getItem(PROJECT_PLANNER_STATE_KEY);
    if (!saved) {
        showHome();
        return;
    }

    try {
        const state = JSON.parse(saved);
        project = state.project || null;
        currentView = state.currentView || 'home';
        activeScopePath = Array.isArray(state.activeScopePath) ? state.activeScopePath : [];
        activeTaskId = state.activeTaskId || null;
        pendingHasParts = Boolean(state.pendingHasParts);
        restoreView();
    } catch (error) {
        console.warn('Saved Project Planner state could not be restored.', error);
        clearSession();
        showHome();
    }
}

function clearSession() {
    localStorage.removeItem(PROJECT_PLANNER_STATE_KEY);
    project = null;
    currentView = 'home';
    activeScopePath = [];
    activeTaskId = null;
    pendingHasParts = false;
}

function hideCompare() {
    document.getElementById('taskCompare').classList.add('hidden');
}

function clearDynamic() {
    hideCompare();
    const container = document.getElementById('dynamicContainer');
    container.innerHTML = '';
    return container;
}

function restoreView() {
    if (!project && currentView !== 'home' && currentView !== 'define-project') {
        showHome();
        return;
    }

    if (currentView === 'define-project') showProjectDefinition();
    else if (currentView === 'parts-entry') showPartsEntry(activeScopePath);
    else if (currentView === 'estimate-task') showEstimateTask(activeScopePath, activeTaskId);
    else if (currentView === 'reorder-task') showReorderTask(activeScopePath, activeTaskId, pendingHasParts);
    else if (currentView === 'subproject-callout') showSubprojectCallout(activeScopePath, activeTaskId);
    else if (currentView === 'summary') showProjectSummary();
    else showHome();
}

function showHome() {
    currentView = 'home';
    activeScopePath = [];
    activeTaskId = null;
    pendingHasParts = false;
    const container = clearDynamic();
    container.innerHTML = `
        <h2>What would you like to do?</h2>
        <div class="choice-box-container">
            <div id="createProjectChoice" class="forced-choice-box">
                CREATE A PROJECT
                <span class="choice-note">I know what I want to accomplish.</span>
            </div>
            <div class="forced-choice-box disabled" aria-disabled="true">
                REVIEW YOUR EXISTING BACKLOG
                <span class="choice-note">Coming soon.</span>
            </div>
        </div>
    `;

    document.getElementById('createProjectChoice').onclick = () => {
        project = null;
        showProjectDefinition();
    };
    saveSession();
}

// --- A1: define the project ---
function showProjectDefinition() {
    currentView = 'define-project';
    const container = clearDynamic();
    container.innerHTML = `
        <h2>Create a Project</h2>
        <label class="field-label" for="projectNameInput">What are you working on?</label>
        <input id="projectNameInput" type="text" placeholder="e.g., Plan the science fair">

        <label class="field-label" for="projectEstimateInput">About how long do you think the whole project will take?</label>
        <input id="projectEstimateInput" type="number" min="1" placeholder="Minutes">

        <button id="defineProjectContinue" class="btn-action">Continue</button>
        <button id="defineProjectCancel" class="secondary-button">Back</button>
    `;

    if (project) {
        document.getElementById('projectNameInput').value = project.name || '';
        document.getElementById('projectEstimateInput').value = project.initialEstimateMinutes || '';
    }

    document.getElementById('defineProjectContinue').onclick = () => {
        const name = document.getElementById('projectNameInput').value.trim();
        const estimate = Number.parseInt(document.getElementById('projectEstimateInput').value, 10);
        if (!name) {
            alert('Please give the project a name.');
            return;
        }
        if (!Number.isFinite(estimate) || estimate < 1) {
            alert('Please enter your best estimate in minutes.');
            return;
        }

        project = {
            id: project?.id || makeId('project'),
            name,
            initialEstimateMinutes: estimate,
            tasks: project?.tasks || []
        };
        saveSession();
        showPartsEntry([]);
    };

    document.getElementById('defineProjectCancel').onclick = showHome;
    saveSession();
}

// --- shared hierarchy helpers ---
function getTaskByPath(path) {
    if (!project || !path.length) return null;
    let tasks = project.tasks;
    let current = null;
    for (const id of path) {
        current = tasks.find(task => task.id === id);
        if (!current) return null;
        tasks = current.children || [];
    }
    return current;
}

function getScopeTasks(scopePath) {
    if (!scopePath.length) return project?.tasks || [];
    const owner = getTaskByPath(scopePath);
    if (!owner) return [];
    owner.children ||= [];
    return owner.children;
}

function setScopeTasks(scopePath, tasks) {
    if (!scopePath.length) {
        project.tasks = tasks;
        return;
    }
    const owner = getTaskByPath(scopePath);
    if (owner) owner.children = tasks;
}

function scopeTitle(scopePath) {
    if (!scopePath.length) return project?.name || 'Project';
    return getTaskByPath(scopePath)?.name || project?.name || 'Project';
}

function findTaskInScope(scopePath, taskId) {
    return getScopeTasks(scopePath).find(task => task.id === taskId) || null;
}

function parseTaskText(text) {
    return String(text || '')
        .split(/\r?\n/)
        .map(line => line.replace(/^\s*\d+[.)]\s*/, '').trim())
        .filter(Boolean);
}

// --- A2: enter all known parts ---
function showPartsEntry(scopePath) {
    activeScopePath = [...scopePath];
    activeTaskId = null;
    pendingHasParts = false;
    currentView = 'parts-entry';

    const title = scopeTitle(scopePath);
    const existing = getScopeTasks(scopePath);
    const container = clearDynamic();
    container.innerHTML = `
        <h2>${escapeHtml(title)}</h2>
        <p><strong>What are all the parts of this project you can think of?</strong></p>
        <textarea id="partsTextarea" rows="9" placeholder="Enter one task or step per line"></textarea>

        <label class="checkbox-row">
            <input type="checkbox" id="skipSortCheckbox">
            <span><strong>Keep this order</strong><br><span class="muted">Skip comparison sorting.</span></span>
        </label>

        <button id="partsContinue" class="btn-action">Continue</button>

        <div class="file-upload-section">
            <p class="muted">Or upload a text or CSV list:</p>
            <input type="file" id="partsFileInput" accept=".txt,.csv,text/plain,text/csv">
        </div>
    `;

    if (existing.length) {
        document.getElementById('partsTextarea').value = existing.map(task => task.name).join('\n');
    }

    document.getElementById('partsFileInput').onchange = event => {
        const file = event.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = loadEvent => {
            const text = String(loadEvent.target.result || '');
            const lines = text.split(/\r?\n/).filter(Boolean);
            const looksLikeCsv = file.name.toLowerCase().endsWith('.csv') || lines[0]?.includes(',');
            if (looksLikeCsv) {
                const names = lines
                    .slice(lines[0]?.toLowerCase().includes('task') ? 1 : 0)
                    .map(line => line.split(',')[0].replace(/^"|"$/g, '').trim())
                    .filter(Boolean);
                document.getElementById('partsTextarea').value = names.join('\n');
            } else {
                document.getElementById('partsTextarea').value = parseTaskText(text).join('\n');
            }
        };
        reader.readAsText(file);
    };

    document.getElementById('partsContinue').onclick = async () => {
        const names = parseTaskText(document.getElementById('partsTextarea').value);
        if (!names.length) {
            alert('Please enter at least one part of the project.');
            return;
        }

        const existingByName = new Map(existing.map(task => [task.name, task]));
        const tasks = names.map(name => existingByName.get(name) || createTask(name));
        const skipSort = document.getElementById('skipSortCheckbox').checked;

        if (skipSort || tasks.length <= 1) {
            setScopeTasks(scopePath, tasks);
            saveSession();
            continueScopePlanning(scopePath);
            return;
        }

        const sorted = await sortTaskObjects(tasks, title);
        setScopeTasks(scopePath, sorted);
        saveSession();
        continueScopePlanning(scopePath);
    };

    saveSession();
}

// --- A3: forced-choice sorting ---
async function sortTaskObjects(tasks, contextTitle) {
    const sorted = await mergeSortInteractive([...tasks], contextTitle);
    hideCompare();
    return sorted;
}

async function mergeSortInteractive(items, contextTitle) {
    if (items.length <= 1) return items;
    const midpoint = Math.floor(items.length / 2);
    const left = await mergeSortInteractive(items.slice(0, midpoint), contextTitle);
    const right = await mergeSortInteractive(items.slice(midpoint), contextTitle);
    return mergeInteractive(left, right, contextTitle);
}

function mergeInteractive(left, right, contextTitle) {
    return new Promise(resolve => {
        const result = [];
        const compare = document.getElementById('taskCompare');
        const task1 = document.getElementById('task1');
        const task2 = document.getElementById('task2');
        document.getElementById('sortContext').textContent = contextTitle;
        document.getElementById('dynamicContainer').innerHTML = '';
        compare.classList.remove('hidden');

        function step() {
            if (!left.length || !right.length) {
                resolve([...result, ...left, ...right]);
                return;
            }

            task1.textContent = left[0].name;
            task2.textContent = right[0].name;
            task1.onclick = () => {
                result.push(left.shift());
                step();
            };
            task2.onclick = () => {
                result.push(right.shift());
                step();
            };
        }

        step();
    });
}

// --- A4: estimate and edit ---
function continueScopePlanning(scopePath) {
    const tasks = getScopeTasks(scopePath);
    const next = tasks.find(task => task.estimatedMinutes === null);

    if (next) {
        showEstimateTask(scopePath, next.id);
        return;
    }

    if (scopePath.length) {
        const parentScope = scopePath.slice(0, -1);
        continueScopePlanning(parentScope);
        return;
    }

    showProjectSummary();
}

function showEstimateTask(scopePath, taskId) {
    const task = findTaskInScope(scopePath, taskId);
    if (!task) {
        continueScopePlanning(scopePath);
        return;
    }

    activeScopePath = [...scopePath];
    activeTaskId = taskId;
    pendingHasParts = false;
    currentView = 'estimate-task';

    const tasks = getScopeTasks(scopePath);
    const index = tasks.findIndex(item => item.id === taskId);
    const container = clearDynamic();
    container.innerHTML = `
        <h2>${escapeHtml(scopeTitle(scopePath))}</h2>
        <p class="muted">Task ${index + 1} of ${tasks.length}</p>
        <h3>${escapeHtml(task.name)}</h3>

        <label class="field-label" for="taskEstimateInput">How long do you think this will take?</label>
        <input id="taskEstimateInput" type="number" min="1" placeholder="Minutes" value="${task.estimatedMinutes || ''}">

        <label class="checkbox-row">
            <input type="checkbox" id="outOfOrderCheckbox">
            <span><strong>This task is out of order</strong><br><span class="muted">Move it to the right place in this project.</span></span>
        </label>

        <label class="checkbox-row">
            <input type="checkbox" id="hasPartsCheckbox">
            <span><strong>This task has parts</strong><br><span class="muted">Turn it into a subproject and break it down.</span></span>
        </label>

        <button id="estimateContinue" class="btn-action">Continue</button>
    `;

    document.getElementById('estimateContinue').onclick = () => {
        const estimate = Number.parseInt(document.getElementById('taskEstimateInput').value, 10);
        if (!Number.isFinite(estimate) || estimate < 1) {
            alert('Please enter your best estimate in minutes.');
            return;
        }

        task.estimatedMinutes = estimate;
        const outOfOrder = document.getElementById('outOfOrderCheckbox').checked;
        const hasParts = document.getElementById('hasPartsCheckbox').checked;
        pendingHasParts = hasParts;
        saveSession();

        if (outOfOrder) {
            showReorderTask(scopePath, taskId, hasParts);
            return;
        }

        handleDecompositionDecision(scopePath, taskId, hasParts);
    };

    saveSession();
}

function showReorderTask(scopePath, taskId, hasParts) {
    const task = findTaskInScope(scopePath, taskId);
    if (!task) {
        continueScopePlanning(scopePath);
        return;
    }

    activeScopePath = [...scopePath];
    activeTaskId = taskId;
    pendingHasParts = Boolean(hasParts);
    currentView = 'reorder-task';

    const tasks = getScopeTasks(scopePath);
    const rest = tasks.filter(item => item.id !== taskId);
    const container = clearDynamic();
    container.innerHTML = `
        <h2>Where should this task go?</h2>
        <div class="reorder-layout">
            <div id="reorderList"></div>
            <div>
                <p class="muted">Moving:</p>
                <div class="task-card">${escapeHtml(task.name)}</div>
            </div>
        </div>
    `;

    const list = document.getElementById('reorderList');
    for (let slot = 0; slot <= rest.length; slot++) {
        const slotRow = document.createElement('div');
        slotRow.className = 'insert-slot';
        const button = document.createElement('button');
        button.className = 'insert-button';
        button.textContent = slot === 0 ? 'Move to top' : slot === rest.length ? 'Move to end' : 'Move here';
        button.onclick = () => {
            const reordered = [...rest];
            reordered.splice(slot, 0, task);
            setScopeTasks(scopePath, reordered);
            saveSession();
            handleDecompositionDecision(scopePath, taskId, hasParts);
        };
        slotRow.appendChild(button);
        list.appendChild(slotRow);

        if (slot < rest.length) {
            const row = document.createElement('div');
            row.className = 'ordered-task';
            row.textContent = `${slot + 1}. ${rest[slot].name}`;
            list.appendChild(row);
        }
    }

    saveSession();
}

function handleDecompositionDecision(scopePath, taskId, hasParts) {
    const task = findTaskInScope(scopePath, taskId);
    if (!task) {
        continueScopePlanning(scopePath);
        return;
    }

    if (hasParts) {
        startSubproject(scopePath, taskId);
        return;
    }

    if (task.estimatedMinutes > AUTO_SUBPROJECT_THRESHOLD_MINUTES && !task.decompositionReviewed) {
        showSubprojectCallout(scopePath, taskId);
        return;
    }

    continueScopePlanning(scopePath);
}

function showSubprojectCallout(scopePath, taskId) {
    const task = findTaskInScope(scopePath, taskId);
    if (!task) {
        continueScopePlanning(scopePath);
        return;
    }

    activeScopePath = [...scopePath];
    activeTaskId = taskId;
    pendingHasParts = false;
    currentView = 'subproject-callout';

    const container = clearDynamic();
    container.innerHTML = `
        <h2>${escapeHtml(scopeTitle(scopePath))}</h2>
        <div class="callout">
            <h3>This may be a project</h3>
            <p><strong>${escapeHtml(task.name)}</strong></p>
            <p>Estimated time: <strong>${task.estimatedMinutes} minutes</strong></p>
            <p>Breaking larger work into smaller parts can make the plan easier to use.</p>
            <div class="choice-box-container">
                <div id="breakIntoPartsChoice" class="forced-choice-box">BREAK INTO PARTS</div>
                <div id="keepSingleChoice" class="forced-choice-box">KEEP AS ONE TASK</div>
            </div>
        </div>
    `;

    document.getElementById('breakIntoPartsChoice').onclick = () => startSubproject(scopePath, taskId);
    document.getElementById('keepSingleChoice').onclick = () => {
        task.decompositionReviewed = true;
        saveSession();
        continueScopePlanning(scopePath);
    };

    saveSession();
}

function startSubproject(parentScopePath, taskId) {
    const task = findTaskInScope(parentScopePath, taskId);
    if (!task) {
        continueScopePlanning(parentScopePath);
        return;
    }

    task.isProject = true;
    task.decompositionReviewed = true;
    task.children ||= [];
    const childScopePath = [...parentScopePath, task.id];
    saveSession();
    showPartsEntry(childScopePath);
}

// --- finished project summary ---
function plannedMinutesForTask(task) {
    if (task.children?.length) {
        return task.children.reduce((sum, child) => sum + plannedMinutesForTask(child), 0);
    }
    return Number(task.estimatedMinutes || 0);
}

function plannedProjectMinutes() {
    return (project?.tasks || []).reduce((sum, task) => sum + plannedMinutesForTask(task), 0);
}

function renderSummaryTasks(tasks) {
    const list = document.createElement('ul');
    list.className = 'summary-list';

    tasks.forEach(task => {
        const item = document.createElement('li');
        const line = document.createElement('div');
        const minutes = task.children?.length ? plannedMinutesForTask(task) : task.estimatedMinutes;
        line.innerHTML = `<strong>${escapeHtml(task.name)}</strong>${minutes ? ` — ${minutes} min` : ''}`;
        item.appendChild(line);

        if (task.children?.length) {
            const children = document.createElement('div');
            children.className = 'summary-children';
            children.appendChild(renderSummaryTasks(task.children));
            item.appendChild(children);
        }
        list.appendChild(item);
    });

    return list;
}

function showProjectSummary() {
    currentView = 'summary';
    activeScopePath = [];
    activeTaskId = null;
    pendingHasParts = false;

    const container = clearDynamic();
    container.innerHTML = `
        <h2>${escapeHtml(project.name)}</h2>
        <p>Initial estimate: <strong>${project.initialEstimateMinutes} minutes</strong></p>
        <p>Planned estimate: <strong>${plannedProjectMinutes()} minutes</strong></p>
        <h3>Project Plan</h3>
        <div id="summaryTasks"></div>
        <div class="choice-box-container">
            <div id="downloadPlanChoice" class="forced-choice-box">DOWNLOAD PROJECT PLAN</div>
            <div id="newProjectChoice" class="forced-choice-box">START A NEW PROJECT</div>
        </div>
    `;

    document.getElementById('summaryTasks').appendChild(renderSummaryTasks(project.tasks));
    document.getElementById('downloadPlanChoice').onclick = downloadProjectPlan;
    document.getElementById('newProjectChoice').onclick = () => {
        if (confirm('Start a new project and clear this local plan?')) {
            clearSession();
            showHome();
        }
    };
    saveSession();
}

function flattenTasks(tasks, depth = 0, rows = []) {
    tasks.forEach(task => {
        rows.push({
            name: `${'  '.repeat(depth)}${task.name}`,
            estimatedMinutes: task.children?.length ? plannedMinutesForTask(task) : (task.estimatedMinutes || 0)
        });
        if (task.children?.length) flattenTasks(task.children, depth + 1, rows);
    });
    return rows;
}

function downloadProjectPlan() {
    const rows = [
        ['Project', project.name],
        ['Initial Estimate Minutes', project.initialEstimateMinutes],
        ['Planned Estimate Minutes', plannedProjectMinutes()],
        [],
        ['Task', 'Estimated Minutes'],
        ...flattenTasks(project.tasks).map(item => [item.name, item.estimatedMinutes])
    ];

    const csv = rows.map(row => row.map(value => `"${String(value ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${project.name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'project'}-plan.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

window.addEventListener('DOMContentLoaded', loadSession);
