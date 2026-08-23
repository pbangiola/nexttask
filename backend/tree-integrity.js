const Database = require('better-sqlite3');
const path = require('path');

const dataDir = process.env.RAILWAY_VOLUME_MOUNT_PATH || __dirname;
const dbPath = path.join(dataDir, 'task_sorter.db');
const db = new Database(dbPath);
db.pragma('foreign_keys = ON');

const getUserNodesStmt = db.prepare(`
    SELECT * FROM tasks
    WHERE user_id = ?
    ORDER BY created, position;
`);

const syncProjectIdStmt = db.prepare(`
    UPDATE tasks
    SET project_id = parent_id, updated_at = ?
    WHERE user_id = ? AND id = ?;
`);

const completeProjectStmt = db.prepare(`
    UPDATE tasks
    SET status = 'completed', completed = ?, last_changed = NULL, updated_at = ?
    WHERE user_id = ? AND id = ? AND node_type = 'project';
`);

const OPEN_STATUSES = new Set(['pending', 'active', 'blocked']);
const CLOSED_STATUSES = new Set(['completed', 'cancelled']);

function isOpen(node) {
    return node && OPEN_STATUSES.has(String(node.status || '').toLowerCase());
}

function isClosed(node) {
    return node && CLOSED_STATUSES.has(String(node.status || '').toLowerCase());
}

function indexNodes(rows) {
    const byId = new Map();
    const childrenByParent = new Map();

    for (const row of rows) {
        byId.set(String(row.id), row);
        const parentKey = row.parent_id == null ? null : String(row.parent_id);
        if (!childrenByParent.has(parentKey)) childrenByParent.set(parentKey, []);
        childrenByParent.get(parentKey).push(row);
    }

    return { byId, childrenByParent };
}

function detectCycles(rows, byId) {
    const cycleIds = new Set();

    for (const node of rows) {
        const path = new Set();
        let cursor = node;

        while (cursor?.parent_id != null) {
            const id = String(cursor.id);
            if (path.has(id)) {
                path.forEach(value => cycleIds.add(value));
                break;
            }
            path.add(id);
            cursor = byId.get(String(cursor.parent_id));
            if (!cursor) break;
        }
    }

    return [...cycleIds];
}

function descendantIsOpen(nodeId, childrenByParent) {
    const stack = [...(childrenByParent.get(String(nodeId)) || [])];
    while (stack.length) {
        const node = stack.pop();
        if (isOpen(node)) return true;
        stack.push(...(childrenByParent.get(String(node.id)) || []));
    }
    return false;
}

function auditRows(rows) {
    const { byId, childrenByParent } = indexNodes(rows);
    const issues = [];

    for (const node of rows) {
        if (node.parent_id != null) {
            const parent = byId.get(String(node.parent_id));
            if (!parent) {
                issues.push({ type: 'missing_parent', nodeId: node.id, parentId: node.parent_id, status: node.status });
            } else {
                if (parent.node_type !== 'project') {
                    issues.push({ type: 'parent_not_project', nodeId: node.id, parentId: parent.id, parentType: parent.node_type });
                }
                if (isOpen(node) && isClosed(parent)) {
                    issues.push({ type: 'open_child_under_closed_parent', nodeId: node.id, parentId: parent.id, parentStatus: parent.status });
                }
            }
        }

        const canonicalProjectId = node.parent_id == null ? null : String(node.parent_id);
        const storedProjectId = node.project_id == null ? null : String(node.project_id);
        if (canonicalProjectId !== storedProjectId) {
            if (canonicalProjectId == null && storedProjectId != null) {
                issues.push({ type: 'orphaned_project_reference', nodeId: node.id, formerProjectId: storedProjectId });
            } else {
                issues.push({ type: 'project_id_mismatch', nodeId: node.id, parentId: canonicalProjectId, projectId: storedProjectId });
            }
        }

        if (node.node_type === 'project') {
            const directChildren = childrenByParent.get(String(node.id)) || [];
            if (!directChildren.length && isOpen(node)) {
                issues.push({ type: 'empty_open_project', nodeId: node.id });
            }
            if (isClosed(node) && descendantIsOpen(node.id, childrenByParent)) {
                issues.push({ type: 'closed_project_with_open_descendant', nodeId: node.id, status: node.status });
            }
            if (isOpen(node) && directChildren.length && !descendantIsOpen(node.id, childrenByParent)) {
                issues.push({ type: 'open_project_without_open_descendants', nodeId: node.id });
            }
        }
    }

    for (const nodeId of detectCycles(rows, byId)) {
        issues.push({ type: 'hierarchy_cycle', nodeId });
    }

    return {
        nodeCount: rows.length,
        openNodeCount: rows.filter(isOpen).length,
        projectCount: rows.filter(row => row.node_type === 'project').length,
        openProjectCount: rows.filter(row => row.node_type === 'project' && isOpen(row)).length,
        rootOpenTasks: rows.filter(row => row.node_type !== 'project' && row.parent_id == null && isOpen(row)).map(row => row.id),
        rootOpenProjects: rows.filter(row => row.node_type === 'project' && row.parent_id == null && isOpen(row)).map(row => row.id),
        issues
    };
}

const reconcileTransaction = db.transaction(userId => {
    const uid = String(userId);
    const repairs = [];

    let rows = getUserNodesStmt.all(uid);

    // parent_id is canonical for live hierarchy. When parent_id is null but a
    // legacy project_id remains, preserve project_id as historical evidence of
    // a former relationship instead of erasing potentially reconstructable data.
    for (const node of rows) {
        const canonicalProjectId = node.parent_id == null ? null : String(node.parent_id);
        const storedProjectId = node.project_id == null ? null : String(node.project_id);
        if (canonicalProjectId != null && canonicalProjectId !== storedProjectId) {
            syncProjectIdStmt.run(Date.now(), uid, node.id);
            repairs.push({ type: 'sync_project_id', nodeId: node.id, projectId: canonicalProjectId });
        }
    }

    // Preserve every project node. Projects are completed in place only when
    // they have historical children and no open descendants. Repeat so nested
    // project completion can cascade upward without flattening the branch.
    let changed = true;
    while (changed) {
        changed = false;
        rows = getUserNodesStmt.all(uid);
        const { childrenByParent } = indexNodes(rows);
        const now = Date.now();

        for (const project of rows.filter(row => row.node_type === 'project' && isOpen(row))) {
            const directChildren = childrenByParent.get(String(project.id)) || [];
            if (!directChildren.length) continue;
            if (descendantIsOpen(project.id, childrenByParent)) continue;

            completeProjectStmt.run(now, now, uid, project.id);
            repairs.push({ type: 'complete_project', nodeId: project.id, completed: now });
            changed = true;
        }
    }

    rows = getUserNodesStmt.all(uid);
    return { repairs, audit: auditRows(rows) };
});

module.exports = {
    audit(userId) {
        return auditRows(getUserNodesStmt.all(String(userId)));
    },

    reconcile(userId) {
        return reconcileTransaction(String(userId));
    }
};
