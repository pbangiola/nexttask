// --- Planning Application State & Session Engine ---
let sessionId = localStorage.getItem('taskSorterSessionId') || 'sess_' + Math.random().toString(36).substr(2, 9);
localStorage.setItem('taskSorterSessionId', sessionId);

let sortedTasks = [];
let currentProjectContext = null;

// --- Existing Projects-branch persistence ---
async function syncSessionToBackend() {
    try {
        await fetch(`/api/session/${sessionId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ state: { sortedTasks, currentProjectContext, activeView: getActiveViewContext() } })
        });
    } catch (e) {
        console.warn('Backend sync offline, relying on local storage fallback.');
    }
}

function saveSession() {
    const sessionState = { sortedTasks, currentProjectContext, activeView: getActiveViewContext() };
    localStorage.setItem('taskSorterStateEngine', JSON.stringify(sessionState));
    syncSessionToBackend();
}

function loadSession() {
    const saved = localStorage.getItem('taskSorterStateEngine');
    initInitialListeners();
    if (!saved) return;
    try {
        const state = JSON.parse(saved);
        sortedTasks = state.sortedTasks || [];
        currentProjectContext = state.currentProjectContext || null;
        routeToStoredView(state.activeView);
    } catch (e) {
        console.warn('Saved planning session could not be restored.', e);
    }
}

function clearSession() {
    localStorage.removeItem('taskSorterStateEngine');
    fetch(`/api/session/${sessionId}`, { method: 'DELETE' }).catch(() => {});
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

// --- App Entry & Landing Listeners ---
function initInitialListeners() {
    const submitBtn = document.getElementById('btnSubmitText');
    const fileInput = document.getElementById('csvFileInput');

    if (submitBtn) submitBtn.onclick = () => {
        const input = document.getElementById('tasksTextarea').value.trim();
        if (!input) { alert('Please enter at least one task to get started.'); return; }
        const items = input.split('\n').map(t => t.trim()).filter(Boolean);
        const skip = document.getElementById('skipSortCheckbox').checked;
        document.getElementById('taskInputContainer').classList.add('hidden');
        if (skip || items.length <= 1) {
            sortedTasks = items.map(name => ({ name, estimatedTime: 0, actualTimeMs: 0 }));
            runUpfrontTimingGateway();
        } else startMergeSort(items);
    };

    if (fileInput) fileInput.onchange = e => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = evt => {
            const lines = evt.target.result.split('\n').map(l => l.trim()).filter(Boolean);
            const items = [];
            for (let i = 1; i < lines.length; i++) {
                const parts = lines[i].match(/(".*?"|[^,]+)(?=\s*,|\s*$|\s*\n)/g);
                if (!parts || parts.length < 1) continue;
                const name = parts[0].replace(/^"|"$/g, '').trim();
                const est = parseInt(parts[1], 10) || 0;
                items.push({ name, estimatedTime: est, actualTimeMs: 0 });
            }
            if (!items.length) { alert("Couldn't find any valid task rows in that file."); return; }
            document.getElementById('taskInputContainer').classList.add('hidden');
            sortedTasks = items;
            displaySortedTasks();
        };
        reader.readAsText(file);
    };
}

function showTaskInputPage() {
    document.getElementById('dynamicContainer').innerHTML = '';
    document.getElementById('taskCompare').classList.add('hidden');
    document.getElementById('taskInputContainer').classList.remove('hidden');
}

// --- Timing Configuration Upfront Gateway ---
function runUpfrontTimingGateway() {
    const container = document.getElementById('dynamicContainer');
    container.innerHTML = `<div id="timingGatewayScreen"><h2>Set Task Times Upfront?</h2><p>Would you like to estimate task durations now, or jump straight to your list?</p><div class="choice-box-container"><div id="gateYes" class="forced-choice-box">Set Times Now</div><div id="gateNo" class="forced-choice-box">Skip and Open List</div></div></div>`;
    document.getElementById('gateYes').onclick = () => runSequentialTimingLoop(0);
    document.getElementById('gateNo').onclick = displaySortedTasks;
    saveSession();
}

function findFirstUntimedTask() {
    const idx = sortedTasks.findIndex(t => !t.estimatedTime);
    return idx < 0 ? sortedTasks.length : idx;
}

function runSequentialTimingLoop(index) {
    if (index >= sortedTasks.length) { displaySortedTasks(); return; }
    const target = sortedTasks[index];
    const container = document.getElementById('dynamicContainer');
    container.innerHTML = `<div id="timingEntryScreen"><h2>Task Time Estimate</h2><p>Task ${index + 1} of ${sortedTasks.length}: <strong>${target.name}</strong></p><input type="number" id="timingValInput" placeholder="Minutes (1-20)" min="1" max="20"><div class="choice-box-container"><div id="btnCommitTime" class="forced-choice-box">Save Estimate</div></div></div>`;
    document.getElementById('btnCommitTime').onclick = () => {
        const val = parseInt(document.getElementById('timingValInput').value, 10);
        if (isNaN(val) || val < 1 || val > 20) { alert('Please pick a time between 1 and 20 minutes.'); return; }
        target.estimatedTime = val;
        saveSession();
        if (val > 15) initiateProjectWizard(index);
        else runSequentialTimingLoop(index + 1);
    };
    saveSession();
}

// --- Project Decomposition Wizard ---
function initiateProjectWizard(parentIndex) {
    currentProjectContext = { parentIndex, parentName: sortedTasks[parentIndex].name, subTaskObjects: [], subIndex: 0, step: 'subtask-input' };
    renderProjectWizardScreen();
}

function resumeProjectWizard() {
    if (!currentProjectContext) { displaySortedTasks(); return; }
    renderProjectWizardScreen();
}

function renderProjectWizardScreen() {
    const container = document.getElementById('dynamicContainer');
    if (currentProjectContext.step === 'subtask-input') {
        container.innerHTML = `<div id="projectBuilderPanel"><h2>Project Detected (&gt;15m)</h2><p>Task: <strong>${currentProjectContext.parentName}</strong></p><div class="choice-box-container"><div id="projKeepSingle" class="forced-choice-box">Keep as a single task</div><div id="projDeconstruct" class="forced-choice-box">Break into sub-tasks</div></div></div>`;
        document.getElementById('projKeepSingle').onclick = () => { const next = currentProjectContext.parentIndex + 1; currentProjectContext = null; saveSession(); runSequentialTimingLoop(next); };
        document.getElementById('projDeconstruct').onclick = () => { currentProjectContext.step = 'enter-subtasks'; saveSession(); renderProjectWizardScreen(); };
    } else if (currentProjectContext.step === 'enter-subtasks') {
        container.innerHTML = `<div id="projectBuilderPanel"><h2>Add Sub-tasks</h2><p>Project: <strong>${currentProjectContext.parentName}</strong></p><textarea id="subtaskTextarea" rows="6" placeholder="Enter sub-tasks (one per line)..."></textarea><div class="choice-box-container"><div id="subtaskSubmit" class="forced-choice-box">Add Sub-tasks</div></div></div>`;
        document.getElementById('subtaskSubmit').onclick = () => {
            const input = document.getElementById('subtaskTextarea').value.trim();
            if (!input) { alert('Please enter at least one sub-task.'); return; }
            currentProjectContext.subTaskObjects = input.split('\n').map(t => t.trim()).filter(Boolean).map(name => ({ name, estimatedTime: 0, actualTimeMs: 0 }));
            currentProjectContext.subIndex = 0;
            currentProjectContext.step = 'timing-subtasks';
            saveSession(); renderProjectWizardScreen();
        };
    } else if (currentProjectContext.step === 'timing-subtasks') {
        const idx = currentProjectContext.subIndex;
        const subTasks = currentProjectContext.subTaskObjects;
        if (idx >= subTasks.length) { finalizeProjectFlattening(currentProjectContext.parentName); return; }
        const targetSub = subTasks[idx];
        container.innerHTML = `<div id="projectBuilderPanel"><h2>Estimate Sub-task Duration</h2><p>Sub-task ${idx + 1} of ${subTasks.length}: <strong>${targetSub.name}</strong></p><input type="number" id="subTimingInput" placeholder="Minutes (1-20)" min="1" max="20"><div class="choice-box-container"><div id="subTimingSubmit" class="forced-choice-box">Save Sub-task Estimate</div></div></div>`;
        document.getElementById('subTimingSubmit').onclick = () => {
            const val = parseInt(document.getElementById('subTimingInput').value, 10);
            if (isNaN(val) || val < 1 || val > 20) { alert('Please enter a value between 1 and 20 minutes.'); return; }
            targetSub.estimatedTime = val;
            if (val > 15) targetSub.name = `${currentProjectContext.parentName}:${targetSub.name}`;
            currentProjectContext.subIndex++;
            saveSession(); renderProjectWizardScreen();
        };
    }
    saveSession();
}

function finalizeProjectFlattening(finalProjectTitle) {
    const parentIndex = currentProjectContext.parentIndex;
    const children = currentProjectContext.subTaskObjects.map(s => ({ name: s.name.startsWith(finalProjectTitle) ? s.name : `${finalProjectTitle}:${s.name}`, estimatedTime: s.estimatedTime, actualTimeMs: 0 }));
    sortedTasks.splice(parentIndex, 1, ...children);
    const resumeIndex = parentIndex + children.length;
    currentProjectContext = null;
    saveSession();
    runSequentialTimingLoop(resumeIndex);
}

// --- Planning Dashboard ---
function displaySortedTasks() {
    document.getElementById('taskInputContainer').classList.add('hidden');
    document.getElementById('taskCompare').classList.add('hidden');
    const container = document.getElementById('dynamicContainer');
    container.innerHTML = `<div id="dashboardScreen"><h2>Your Plan</h2></div>`;
    const view = document.getElementById('dashboardScreen');
    const total = sortedTasks.reduce((sum, t) => sum + (t.estimatedTime || 0), 0);
    const duration = document.createElement('h3'); duration.textContent = `Total Estimated Duration: ${total} Minutes`; view.appendChild(duration);
    const list = document.createElement('ol');
    sortedTasks.forEach(t => { const li = document.createElement('li'); li.textContent = `${t.name}${t.estimatedTime ? ` — ${t.estimatedTime} min` : ''}`; list.appendChild(li); });
    view.appendChild(list);
    const controls = document.createElement('div'); controls.className = 'choice-box-container';
    const exportBtn = document.createElement('div'); exportBtn.className = 'forced-choice-box'; exportBtn.textContent = 'Download Task List'; exportBtn.onclick = downloadTaskList;
    const restart = document.createElement('div'); restart.className = 'forced-choice-box'; restart.textContent = 'Start Over'; restart.onclick = () => { if (confirm('Reset this plan and create a new list?')) { clearSession(); showTaskInputPage(); } };
    controls.append(exportBtn, restart); view.appendChild(controls); saveSession();
}

function downloadTaskList() {
    const rows = ['Task,Estimated Minutes', ...sortedTasks.map(t => `"${String(t.name).replace(/"/g, '""')}",${t.estimatedTime || 0}`)];
    const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'task-plan.csv'; a.click(); URL.revokeObjectURL(url);
}

// --- Interactive Merge Sort ---
function startMergeSort(array) {
    mergeSortInteractive(array).then(res => { sortedTasks = res.map(name => ({ name, estimatedTime: 0, actualTimeMs: 0 })); runUpfrontTimingGateway(); });
}
async function mergeSortInteractive(array) {
    if (array.length <= 1) return array;
    const mid = Math.floor(array.length / 2);
    const left = await mergeSortInteractive(array.slice(0, mid));
    const right = await mergeSortInteractive(array.slice(mid));
    return mergeInteractive(left, right);
}
function mergeInteractive(left, right) {
    return new Promise(resolve => {
        const result = [];
        function step() {
            if (!left.length || !right.length) { document.getElementById('taskCompare').classList.add('hidden'); resolve([...result, ...left, ...right]); return; }
            document.getElementById('taskCompare').classList.remove('hidden');
            document.getElementById('task1').textContent = left[0]; document.getElementById('task2').textContent = right[0];
            document.getElementById('task1').onclick = () => { result.push(left.shift()); step(); };
            document.getElementById('task2').onclick = () => { result.push(right.shift()); step(); };
        }
        step();
    });
}

window.addEventListener('DOMContentLoaded', loadSession);
