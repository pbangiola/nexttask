'use strict';

//load and set global variables

const API_BASE_URL = 'https://nexttask-production.up.railway.app';
const MAX_TASK_MINUTES = 60;
const TEN_MINUTES_MS = 10 * 60 * 1000;
const LOCAL_STATE_KEY = 'taskSorterSession_fallback';

let sessionId = localStorage.getItem('taskSorterSessionId') || createId('session');
let userId = localStorage.getItem('taskSorterUserId') || createId('user');
localStorage.setItem('taskSorterSessionId', sessionId);
localStorage.setItem('taskSorterUserId', userId);

let sortedTasks = [];
let activeTaskId = null;
let timerInterval = null;
let totalAvailableTimeMs = 0;
let sessionStartedAtMs = 0;
let hardStopAtMs = 0;
let hardStopInterval = null;
let hardStopHandled = false;
let endConstraint = '';
let sortStartedAt = null;
let currentSortNames = [];
let sortRunId = 0;
let timeLimitNextStep = null;

function createId(prefix) {
    const random = globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2, 11);
    return `${prefix}_${random}`;
}

function beginTimedSession(durationMs, now = Date.now()) {
    totalAvailableTimeMs = Math.max(0, Number(durationMs || 0));
    sessionStartedAtMs = totalAvailableTimeMs > 0 ? now : 0;
    hardStopAtMs = totalAvailableTimeMs > 0 ? now + totalAvailableTimeMs : 0;
    hardStopHandled = false;
    startHardStopWatch();
}

function continueAfterTimeLimitChoice() {
    const nextStep = timeLimitNextStep;
    timeLimitNextStep = null;

    if (nextStep === 'resume-list') {
        resumeExistingList();
        return;
    }

    saveLocal('input');
    showTaskInput();
}

function showTimeLimitQuestion(nextStep) {
    timeLimitNextStep = nextStep;

    // Every new work session gets a fresh timing decision. This prevents a
    // previous session's hard stop from carrying into a new or resumed list.
    clearSessionTiming();
    endConstraint = '';

    hideStaticScreens();
    hide(el('stopWorkingBtn'));
    show(el('startOverBtn'));

    const container = clearDynamic();
    const screen = document.createElement('div');
    screen.id = 'timeLimitQuestionScreen';

    const heading = document.createElement('h2');
    heading.textContent = 'Do you have a time limit?';

    const yes = document.createElement('button');
    yes.textContent = 'Yes, I have a definite stop time.';
    yes.onclick = showTimeConstraint;

    const no = document.createElement('button');
    no.textContent = "No, I don't have a set stop time.";
    no.onclick = () => {
        clearSessionTiming();
        endConstraint = '';
        continueAfterTimeLimitChoice();
    };

    screen.append(heading, yes, no);
    container.appendChild(screen);
    saveLocal('work-choice');
}

function bindEvents(){
    el('workBtn').onclick=showWorkChoice;
    el('createNewListBtn').onclick=()=>showTimeLimitQuestion('new-list');
    el('resumeExistingListBtn').onclick=()=>showTimeLimitQuestion('resume-list');
    el('timeConstraintNextBtn').onclick=()=>{
        const minutes=Number.parseInt(el('availableTime').value,10);
        if(!Number.isFinite(minutes)||minutes<1){alert('Enter the number of minutes you have available.');return;}
        beginTimedSession(minutes * 60000);
        endConstraint=el('endConstraint').value.trim();
        saveLocal(timeLimitNextStep === 'resume-list' ? 'work-choice' : 'input');
        continueAfterTimeLimitChoice();
    };
    el('tasks').addEventListener('input',updateCapacityMessage);
    el('startSort').onclick=startSorting;
    el('csvUpload').onchange=event=>{const file=event.target.files?.[0];if(file)importFile(file);};
    el('stopWorkingBtn').onclick=stopWorking;
    el('startOverBtn').onclick=showStartOverPrompt;
}

//session deadline functions
function hasHardStop() {
    return Number.isFinite(hardStopAtMs) && hardStopAtMs > 0;
}

//tasklist import functions
function importFile(file) {
    const reader = new FileReader();

    reader.onload = event => {
        const text = String(event.target.result || '');
        const rows = parseCsv(text);
        const headers = (rows[0] || []).map(value => String(value).trim().toLowerCase());
        const nameIndex = headers.findIndex(value =>
            ['task name', 'task', 'name', 'title', 'reminder'].includes(value)
        );
        const idIndex = headers.findIndex(value => ['task id', 'id'].includes(value));
        const estimateIndex = headers.findIndex(value => value.includes('estimated'));
        const actualIndex = headers.findIndex(value => value.includes('actual'));
        const completedIndex = headers.findIndex(value =>
            ['completed', 'done', 'status'].includes(value)
        );
        const structured = nameIndex >= 0;

        if (structured) {
            sortedTasks = rows.slice(1)
                .map(row => createTask(row[nameIndex], {
                    id: idIndex >= 0 ? row[idIndex] : undefined,
                    estimatedTimeMs: estimateIndex >= 0
                        ? Number(row[estimateIndex] || 0) * 60_000
                        : 0,
                    actualTimeMs: actualIndex >= 0
                        ? Number(row[actualIndex] || 0) * 60_000
                        : 0,
                    completed: completedIndex >= 0
                        && ['true', 'yes', '1', 'done', 'completed']
                            .includes(String(row[completedIndex]).toLowerCase())
                }))
                .filter(task => task.name);
        } else {
            const exportedNames = parseNextTaskTextExport(text);
            const names = exportedNames ?? parsePlainTaskText(text);
            sortedTasks = names.map(name => createTask(name));
        }

        if (!sortedTasks.length) {
            alert('No unfinished tasks were found in that file.');
            return;
        }

        hide(el('taskInput'));
        el('csvUpload').value = '';
        activeTaskId = firstIncompleteTask()?.id || null;

        if (structured && idIndex >= 0) showDashboard();
        else showTimingGateway();
    };

    reader.onerror = () => alert('That file could not be read.');
    reader.readAsText(file);
}

//task input ui functions
function updateCapacityMessage() {
    const textarea = el('tasks'); if (!textarea) return;
    const tasks = parseTaskEntryText(textarea.value);
    let message = el('capacityInfoMsg');
    if (!message) { message = document.createElement('p'); message.id='capacityInfoMsg'; message.style.fontWeight='bold'; textarea.insertAdjacentElement('afterend', message); }
    if (!totalAvailableTimeMs) { message.textContent=''; return; }
    const estimated = tasks.length * TEN_MINUTES_MS;
    message.textContent = `Estimated capacity: ${Math.round(estimated/60000)} / ${Math.round(totalAvailableTimeMs/60000)} minutes.`;
    message.style.color = estimated > totalAvailableTimeMs ? '#d32f2f' : '#2e7d32';
}
function parseTaskEntryText(text) {
    const trimmed = String(text || '').trim();
    if (!trimmed) return [];
    const pieces = trimmed.includes('\n') ? trimmed.split(/\r?\n/) : trimmed.split(',');
    return pieces
        .map(value => value.replace(/^\s*\d+[.)]\s*/, '').trim())
        .filter(Boolean);
}
function parsePlainTaskText(text) {
    return [...new Set(parseTaskEntryText(text))];
}


function parseCsv(text) {
    if (globalThis.Papa?.parse) {
        try {
            const result = Papa.parse(text, { skipEmptyLines: true });
            if (!result.errors.length) return result.data;
        } catch (error) {
            console.warn('CSV helper failed; using basic parser:', error);
        }
    }

    return text
        .split(/\r?\n/)
        .filter(Boolean)
        .map(line => line.split(',').map(cell => cell.trim()));
}


//prevent users from enetering duplicate task names
function resolveDuplicateTaskNames(names) {
    const resolved = [];
    const usedKeys = new Set();

    names.forEach(rawName => {
        const name = String(rawName || '').trim().replace(/\s+/g, ' ');
        const key = duplicateKey(name);

        if (!usedKeys.has(key)) {
            resolved.push(name);
            usedKeys.add(key);
            return;
        }

        const renamed = nextAvailableAgainName(name, usedKeys);
        const keepDuplicate = confirm(
            `“${name}” appears more than once.\n\n` +
            `Keep this copy as “${renamed}”?\n\n` +
            'Choose Cancel to remove the duplicate.'
        );

        if (keepDuplicate) {
            resolved.push(renamed);
            usedKeys.add(duplicateKey(renamed));
        }
    });

    return resolved;
}
//suggest an alternative task name
function nextAvailableAgainName(baseName, usedKeys) {
    const cleanBase = String(baseName || '').trim().replace(/\s+/g, ' ');
    let candidate = `${cleanBase} again`;
    let suffix = 2;

    while (usedKeys.has(duplicateKey(candidate))) {
        candidate = `${cleanBase} again ${suffix}`;
        suffix += 1;
    }

    return candidate;
}

function duplicateKey(name) {
    return String(name || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}