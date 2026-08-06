// Final browser-side compatibility overrides for chatgpt-2.
(function installFinalOverrides() {
    const TEN_MINUTES_MS = 10 * 60 * 1000;

    function taskIsCompleted(task) {
        return Boolean(task.completed || task.completedTime || task.timestamps?.completed || task.status === 'completed');
    }

    window.getTotalAllocatedTime = function getTotalAllocatedTime() {
        return sortedTasks
            .filter(task => !taskIsCompleted(task))
            .reduce((totalMs, task) => {
                const estimateMs = Number(task.estimatedTimeMs ?? (task.estimatedTime || 0) * 60000);
                return totalMs + (estimateMs > 0 ? estimateMs : TEN_MINUTES_MS);
            }, 0) / 60000;
    };

    window.clearSession = async function clearSession() {
        localStorage.removeItem('taskSorterSession_fallback');
        localStorage.removeItem('taskSorterSessionId');
        sessionId = `session_${Math.random().toString(36).substring(2, 9)}`;
        localStorage.setItem('taskSorterSessionId', sessionId);
    };

    function csvEscape(value) {
        const text = String(value ?? '');
        return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    }

    window.exportCompletedTasksCSV = function exportCompletedTasksCSV() {
        if (!Array.isArray(sortedTasks) || sortedTasks.length === 0) return;

        const header = [
            'Task Name',
            'Estimated Time (Min)',
            'Actual Time (Min)',
            'Completed',
            'Task ID'
        ];

        const rows = sortedTasks.map(task => {
            ensureTaskId(task);
            const estimatedMs = Number(task.estimatedTimeMs ?? (task.estimatedTime || 0) * 60000);
            const actualMs = Number(task.actualTimeMs || 0);
            return [
                task.name,
                Math.round(estimatedMs / 60000),
                Math.round(actualMs / 60000),
                taskIsCompleted(task),
                task.id
            ].map(csvEscape).join(',');
        });

        triggerFileDownload(
            [header.join(','), ...rows].join('\n'),
            `tasks_${getFormattedDateTimeForFilename()}.csv`,
            'text/csv;charset=utf-8;'
        );
    };

    function createTaskFromImport(values = {}) {
        const now = Date.now();
        const id = values.id || (
            typeof crypto !== 'undefined' && crypto.randomUUID
                ? crypto.randomUUID()
                : `task_${now}_${Math.random().toString(36).slice(2, 10)}`
        );
        const completed = values.completed === true;
        const estimatedTimeMs = Math.max(0, Number(values.estimatedTimeMs || 0));
        const actualTimeMs = Math.max(0, Number(values.actualTimeMs || 0));

        return {
            id,
            name: String(values.name || '').trim(),
            completed,
            status: completed ? 'completed' : 'pending',
            estimatedTimeMs,
            estimatedTime: Math.round(estimatedTimeMs / 60000),
            actualTimeMs,
            created: Number(values.created || now),
            started: values.started ?? null,
            completedTime: completed ? Number(values.completedTime || now) : null,
            lastChanged: null,
            timestamps: {
                created: Number(values.created || now),
                started: values.started ?? null,
                completed: completed ? Number(values.completedTime || now) : null
            }
        };
    }

    function parseBoolean(value) {
        return ['true', 'yes', '1', 'completed', 'done'].includes(String(value || '').trim().toLowerCase());
    }

    function simpleCsvRows(text) {
        const rows = [];
        let row = [];
        let value = '';
        let quoted = false;

        for (let index = 0; index < text.length; index++) {
            const character = text[index];
            if (character === '"') {
                if (quoted && text[index + 1] === '"') {
                    value += '"';
                    index++;
                } else {
                    quoted = !quoted;
                }
            } else if (character === ',' && !quoted) {
                row.push(value);
                value = '';
            } else if ((character === '\n' || character === '\r') && !quoted) {
                if (character === '\r' && text[index + 1] === '\n') index++;
                row.push(value);
                if (row.some(cell => String(cell).trim())) rows.push(row);
                row = [];
                value = '';
            } else {
                value += character;
            }
        }

        row.push(value);
        if (row.some(cell => String(cell).trim())) rows.push(row);
        return rows;
    }

    function parseStructuredRows(rows) {
        if (!rows.length) return [];

        const headers = rows[0].map(value => String(value).trim().toLowerCase());
        const nameIndex = headers.findIndex(header => /^(task name|task|name|title|reminder)$/.test(header));
        const idIndex = headers.findIndex(header => /^(task id|id)$/.test(header));
        const estimatedIndex = headers.findIndex(header => header.includes('estimated'));
        const actualIndex = headers.findIndex(header => header.includes('actual'));
        const completedIndex = headers.findIndex(header => /^(completed|done|status)$/.test(header));
        const hasHeader = nameIndex >= 0;

        if (!hasHeader) {
            return rows
                .flatMap(row => row)
                .map(name => createTaskFromImport({ name }))
                .filter(task => task.name);
        }

        return rows.slice(1).map(row => createTaskFromImport({
            name: row[nameIndex],
            id: idIndex >= 0 ? String(row[idIndex] || '').trim() : null,
            estimatedTimeMs: estimatedIndex >= 0 ? (Number(row[estimatedIndex]) || 0) * 60000 : 0,
            actualTimeMs: actualIndex >= 0 ? (Number(row[actualIndex]) || 0) * 60000 : 0,
            completed: completedIndex >= 0 ? parseBoolean(row[completedIndex]) : false
        })).filter(task => task.name);
    }

    function parseImportedText(text, filename = '') {
        const trimmed = String(text || '').trim();
        if (!trimmed) return [];

        if (typeof Papa !== 'undefined' && typeof Papa.parse === 'function') {
            try {
                const result = Papa.parse(trimmed, { skipEmptyLines: true });
                if (!result.errors?.length && Array.isArray(result.data)) {
                    return parseStructuredRows(result.data);
                }
            } catch (error) {
                console.warn('Papa Parse failed; using built-in parser:', error);
            }
        }

        const looksCsv = filename.toLowerCase().endsWith('.csv')
            || trimmed.includes(',')
            || /^task name,/i.test(trimmed);

        if (looksCsv) return parseStructuredRows(simpleCsvRows(trimmed));

        return trimmed
            .split(/\r?\n/)
            .flatMap(line => {
                const cleaned = line.replace(/^\s*\d+[.)]\s*/, '').trim();
                if (!cleaned || /^uncompleted tasks$/i.test(cleaned) || /^-{3,}$/.test(cleaned)) return [];
                return cleaned.includes(',') ? cleaned.split(',') : [cleaned];
            })
            .map(name => createTaskFromImport({ name }))
            .filter(task => task.name);
    }

    function installUploadHandler() {
        const original = document.getElementById('csvUpload');
        if (!original || original.dataset.finalImportInstalled === 'true') return;

        const replacement = original.cloneNode(true);
        replacement.dataset.finalImportInstalled = 'true';
        replacement.accept = '.txt,.csv,text/plain,text/csv';
        original.replaceWith(replacement);

        replacement.addEventListener('change', event => {
            const file = event.target.files?.[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = loadEvent => {
                const tasks = parseImportedText(loadEvent.target.result, file.name);
                if (!tasks.length) {
                    alert("We couldn't find any tasks in that file.");
                    return;
                }

                sortedTasks = tasks;
                currentTaskIndex = tasks.findIndex(task => !task.completed);
                if (currentTaskIndex < 0) currentTaskIndex = tasks.length;
                activeTaskId = tasks[currentTaskIndex]?.id || null;

                localStorage.setItem('taskSorterSession_fallback', JSON.stringify({
                    sortedTasks,
                    activeTaskId,
                    currentTaskIndex,
                    totalAvailableTime,
                    endConstraint,
                    activeView: 'dashboard'
                }));

                displaySortedTasks();
            };
            reader.onerror = () => console.warn('Task import file could not be read.');
            reader.readAsText(file);
        });
    }

    function installCommaInputNormalization() {
        const startButton = document.getElementById('startSort');
        if (!startButton || startButton.dataset.commaNormalizer === 'true') return;
        startButton.dataset.commaNormalizer = 'true';

        startButton.addEventListener('click', () => {
            const textarea = document.getElementById('tasks');
            if (!textarea) return;
            const text = textarea.value.trim();
            if (text && !text.includes('\n') && text.includes(',')) {
                textarea.value = text
                    .split(',')
                    .map(task => task.trim())
                    .filter(Boolean)
                    .join('\n');
            }
        }, true);
    }

    function installWhenReady() {
        installUploadHandler();
        installCommaInputNormalization();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', installWhenReady);
    } else {
        installWhenReady();
    }

    setTimeout(installWhenReady, 500);
})();
