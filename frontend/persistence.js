'use strict';

// functions for saving and restoring state

function backupToServer() {
    fetch(`${API_BASE_URL}/api/session/${encodeURIComponent(sessionId)}/tasks`, { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(serverPayload()) })
        .then(response => { if (!response.ok) throw new Error(`Backup failed (${response.status})`); })
        .catch(error => console.warn('Server backup failed; browser state is safe:', error));
}
function save(view = inferView()) { saveLocal(view); backupToServer(); }

function inferView() {
    if (el('focusScreen')) return 'focus';
    if (el('dashboardScreen')) return 'dashboard';
    if (!el('taskCompare')?.classList.contains('hidden')) return 'sorting';
    if (el('timingGatewayScreen')) return 'timing-gateway';
    if (el('timingEntryScreen')) return 'timing-entry';
    if (el('completionScreen')) return 'completion';
    if (el('sessionEndedScreen')) return 'session-ended';
    if (el('stopChecklistScreen')) return 'stop-checklist';
    if (!el('taskInput')?.classList.contains('hidden')) return 'input';
    if (!el('timeConstraintInput')?.classList.contains('hidden')) return 'time-constraint';
    if (!el('workChoiceStep')?.classList.contains('hidden')) return 'work-choice';
    return 'mode-select';
}
function restoreLocalState() {
    const raw = localStorage.getItem(LOCAL_STATE_KEY); if (!raw) return false;
    try {
        const state = JSON.parse(raw);
        sortedTasks = Array.isArray(state.sortedTasks) ? state.sortedTasks.map(ensureTask) : [];
        activeTaskId = state.activeTaskId || null;
        totalAvailableTimeMs = Math.max(0, Number(state.totalAvailableTimeMs || 0));
        sessionStartedAtMs = Math.max(0, Number(state.sessionStartedAtMs || 0));
        hardStopAtMs = Math.max(0, Number(state.hardStopAtMs || 0));
        endConstraint = String(state.endConstraint || '');
        hardStopHandled = state.view === 'session-ended';
        return state;
    }
    catch (error) { console.warn('Local session could not be restored:', error); return false; }
}

function localSnapshot(view) {
    return {
        sortedTasks,
        activeTaskId,
        totalAvailableTimeMs,
        sessionStartedAtMs,
        hardStopAtMs,
        endConstraint,
        view,
        updatedAt: Date.now()
    };
}
function saveLocal(view = inferView()) { localStorage.setItem(LOCAL_STATE_KEY, JSON.stringify(localSnapshot(view))); }
function serverPayload() {
    return {
        userId,
        totalAvailableTimeMs,
        sessionStartedAtMs,
        hardStopAtMs,
        endConstraint,
        tasks: sortedTasks.map((task,index) => {
        ensureTask(task);
        return { id: task.id, name: task.name, status: task.completed ? 'completed' : task.status,
            estimatedTimeMs: task.estimatedTimeMs, actualTimeMs: task.actualTimeMs, position: index + 1,
            created: task.created, started: task.started, completedTime: task.completedTime,
            lastChanged: task.lastChanged, blockedByTaskId: task.blockedByTaskId };
        })
    };
}

//file export functions
function normalizedExportHeading(line) {
    return String(line || '')
        .trim()
        .toLocaleLowerCase()
        .replace(/[：:]+$/, '')
        .replace(/\s+/g, ' ');
}

function isExportSeparator(line) {
    const compact = String(line || '').replace(/\s/g, '');
    return compact.length >= 3 && /^[\-—–_=*]+$/.test(compact);
}

function cleanExportTaskLine(line) {
    let cleaned = String(line || '').trim();

    cleaned = cleaned
        .replace(/^\s*(?:[-*•]\s+|\d+[.)]\s+|(?:\[[ xX✓✔]\]|☐|☑)\s*)/, '')
        .replace(/\s*[✓✔]\s*$/, '')
        .replace(/\s+[—–-]\s+(?:blocked|completed|complete|done)\s*$/i, '')
        .replace(/\s+[—–-]\s+\d+(?:\.\d+)?\s*(?:min|mins|minute|minutes)\s*$/i, '')
        .trim();

    return cleaned;
}

function parseNextTaskTextExport(text) {
    const lines = String(text || '').split(/\r?\n/);
    const openHeadings = new Set([
        'uncompleted tasks',
        'incomplete tasks',
        'unfinished tasks',
        'remaining tasks',
        'tasks remaining'
    ]);
    const completedHeadings = new Set([
        'completed tasks',
        'finished tasks',
        'done tasks'
    ]);
    const neutralHeadings = new Set([
        'task sorter',
        'task list',
        'your task list',
        'sorted task list',
        'nexttask'
    ]);

    let recognizedFormat = false;
    let section = 'open';
    const names = [];

    for (const rawLine of lines) {
        const line = String(rawLine || '').trim();
        if (!line) continue;

        const heading = normalizedExportHeading(line);

        if (openHeadings.has(heading)) {
            recognizedFormat = true;
            section = 'open';
            continue;
        }

        if (completedHeadings.has(heading)) {
            recognizedFormat = true;
            section = 'completed';
            continue;
        }

        if (neutralHeadings.has(heading) || isExportSeparator(line)) {
            recognizedFormat = true;
            continue;
        }

        // A restored list should contain unfinished work only. Completed-section
        // entries remain historical and should not be re-added to the queue.
        if (section === 'completed') continue;

        const cleaned = cleanExportTaskLine(line);
        if (cleaned) names.push(cleaned);
    }

    if (!recognizedFormat) return null;
    return [...new Set(names)];
}
function csvEscape(value){const text=String(value??'');return /[",\n]/.test(text)?`"${text.replace(/"/g,'""')}"`:text;}
function exportCsv(){const rows=[['Task Name','Estimated Time (Min)','Actual Time (Min)','Completed','Task ID']];sortedTasks.forEach(task=>rows.push([task.name,Math.round(task.estimatedTimeMs/60000),Math.round(task.actualTimeMs/60000),task.completed,task.id]));const blob=new Blob([rows.map(row=>row.map(csvEscape).join(',')).join('\n')],{type:'text/csv'});const link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download=`tasks_${new Date().toISOString().slice(0,16).replace(/[:T]/g,'-')}.csv`;link.click();URL.revokeObjectURL(link.href);}

