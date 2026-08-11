'use strict';

window.ProjectCSV = (() => {
    const FORMAT_VERSION = '1';
    const HEADERS = [
        'format_version',
        'source_id',
        'source_parent_id',
        'node_type',
        'name',
        'estimated_ms',
        'position',
        'independently_actionable'
    ];

    const makeId = prefix => `${prefix}_${globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2, 11)}`;

    async function api(path, options = {}) {
        const response = await fetch(`${API_BASE_URL}/api/users/${encodeURIComponent(userId)}${path}`, {
            ...options,
            headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
        });
        let body = null;
        try { body = await response.json(); } catch (_) {}
        if (!response.ok) throw new Error(body?.error || `Project CSV request failed (${response.status})`);
        return body;
    }

    async function tree() {
        return (await api('/nodes?tree=1')).nodes || [];
    }

    async function createNode(input) {
        return (await api('/nodes', {
            method: 'POST',
            body: JSON.stringify(input)
        })).node;
    }

    function findNode(nodes, id) {
        for (const node of nodes || []) {
            if (node.id === id) return node;
            const found = findNode(node.children || [], id);
            if (found) return found;
        }
        return null;
    }

    function flattenActive(node, parentSourceId = '') {
        if (!node || ['completed', 'cancelled'].includes(node.status)) return [];
        const row = {
            format_version: FORMAT_VERSION,
            source_id: node.id,
            source_parent_id: parentSourceId,
            node_type: node.node_type === 'project' ? 'project' : 'task',
            name: node.name,
            estimated_ms: Number(node.estimated_ms || 0),
            position: Number(node.position || 0),
            independently_actionable: Number(node.independently_actionable ? 1 : 0)
        };
        return [row, ...(node.children || []).flatMap(child => flattenActive(child, node.id))];
    }

    function csvEscape(value) {
        const text = String(value ?? '');
        return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    }

    function rowsToCsv(rows) {
        return [
            HEADERS.join(','),
            ...rows.map(row => HEADERS.map(header => csvEscape(row[header])).join(','))
        ].join('\r\n');
    }

    function safeFilename(name) {
        const base = String(name || 'project').trim().replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '');
        return `${base || 'project'}-project.csv`;
    }

    async function exportProject(projectId) {
        const root = findNode(await tree(), projectId);
        if (!root) throw new Error('Project not found.');
        if (root.node_type !== 'project') throw new Error('Only projects can be exported with the project CSV format.');
        const rows = flattenActive(root, '');
        const blob = new Blob([rowsToCsv(rows)], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = safeFilename(root.name);
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
    }

    function parseCsv(text) {
        if (globalThis.Papa?.parse) {
            const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
            if (parsed.errors?.length) throw new Error(parsed.errors[0].message || 'Could not parse CSV.');
            return parsed.data;
        }
        throw new Error('CSV parser is unavailable.');
    }

    function normalizeRows(rawRows) {
        if (!rawRows.length) throw new Error('The CSV is empty.');
        const rows = rawRows.map((raw, index) => {
            const version = String(raw.format_version ?? '').trim();
            if (version !== FORMAT_VERSION) throw new Error(`Unsupported project CSV version on row ${index + 2}.`);
            const sourceId = String(raw.source_id ?? '').trim();
            const sourceParentId = String(raw.source_parent_id ?? '').trim();
            const nodeType = String(raw.node_type ?? '').trim();
            const name = String(raw.name ?? '').trim();
            const estimatedMs = Number(raw.estimated_ms ?? 0);
            const position = Number(raw.position ?? 0);
            const independentlyActionable = Number(raw.independently_actionable ?? 1) ? 1 : 0;
            if (!sourceId) throw new Error(`Missing source_id on row ${index + 2}.`);
            if (!name) throw new Error(`Missing name on row ${index + 2}.`);
            if (!['task', 'project'].includes(nodeType)) throw new Error(`Invalid node_type on row ${index + 2}.`);
            if (!Number.isFinite(estimatedMs) || estimatedMs < 0) throw new Error(`Invalid estimated_ms on row ${index + 2}.`);
            return { sourceId, sourceParentId, nodeType, name, estimatedMs, position, independentlyActionable };
        });

        const ids = new Set(rows.map(row => row.sourceId));
        if (ids.size !== rows.length) throw new Error('The CSV contains duplicate source_id values.');
        for (const row of rows) {
            if (row.sourceParentId && !ids.has(row.sourceParentId)) {
                throw new Error(`Missing parent row for ${row.name}.`);
            }
        }
        const roots = rows.filter(row => !row.sourceParentId);
        if (!roots.length) throw new Error('The CSV has no root project.');
        if (roots.some(row => row.nodeType !== 'project')) throw new Error('Every imported root must be a project.');
        return rows;
    }

    async function importProjectCsv(file) {
        const text = await file.text();
        const rows = normalizeRows(parseCsv(text));
        const pending = [...rows];
        const idMap = new Map();
        let created = 0;

        while (pending.length) {
            let progressed = false;
            for (let index = pending.length - 1; index >= 0; index--) {
                const row = pending[index];
                if (row.sourceParentId && !idMap.has(row.sourceParentId)) continue;
                const id = makeId(row.nodeType === 'project' ? 'project' : 'task');
                const parentId = row.sourceParentId ? idMap.get(row.sourceParentId) : null;
                await createNode({
                    id,
                    name: row.name,
                    nodeType: row.nodeType,
                    parentId,
                    estimatedTimeMs: row.estimatedMs,
                    position: row.position,
                    independentlyActionable: row.nodeType === 'project' ? false : Boolean(row.independentlyActionable),
                    sessionId
                });
                idMap.set(row.sourceId, id);
                pending.splice(index, 1);
                created++;
                progressed = true;
            }
            if (!progressed) throw new Error('The CSV hierarchy contains a cycle or unresolved parent.');
        }
        return created;
    }

    function injectControls() {
        const projectList = document.getElementById('projectList');
        if (projectList && !document.getElementById('projectCsvImport')) {
            const wrapper = document.createElement('div');
            wrapper.className = 'upload-container';
            wrapper.innerHTML = '<h3>Import Project CSV</h3><input id="projectCsvImport" type="file" accept=".csv,text/csv">';
            projectList.insertAdjacentElement('afterend', wrapper);
            const input = document.getElementById('projectCsvImport');
            input.onchange = async event => {
                const file = event.target.files?.[0];
                if (!file) return;
                try {
                    const count = await importProjectCsv(file);
                    alert(`Imported ${count} project node${count === 1 ? '' : 's'}.`);
                    localStorage.setItem('nextTaskProjectPlannerUi', JSON.stringify({ view: 'projects-list' }));
                    window.ProjectPlanner?.open?.();
                } catch (error) {
                    alert(`Import failed: ${error.message}`);
                }
            };
        }

        const editorBack = document.getElementById('projectEditorBack');
        if (editorBack && !document.getElementById('projectCsvExport')) {
            const button = document.createElement('button');
            button.id = 'projectCsvExport';
            button.textContent = 'Export Project CSV';
            button.onclick = async () => {
                try {
                    const title = document.querySelector('#dynamicContainer h2')?.textContent || '';
                    const all = await tree();
                    const match = all.flatMap(function collect(node) {
                        return [node, ...(node.children || []).flatMap(collect)];
                    }).find(node => node.node_type === 'project' && node.name === title && !['completed', 'cancelled'].includes(node.status));
                    if (!match) throw new Error('Could not identify the open project.');
                    await exportProject(match.id);
                } catch (error) {
                    alert(`Export failed: ${error.message}`);
                }
            };
            editorBack.parentNode.insertBefore(button, editorBack);
        }
    }

    const observer = new MutationObserver(injectControls);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    document.addEventListener('DOMContentLoaded', injectControls);
    injectControls();

    return { exportProject, importProjectCsv };
})();
