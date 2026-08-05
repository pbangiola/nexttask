// Canonical-task-only persistence overrides.
// Loaded after frontend.js so the existing workflow can keep its function names
// while all reads and writes use the canonical tasks API.

async function fetchExistingQueue() {
    const canonicalRows = await fetchCanonicalTasks();
    return canonicalRows
        .filter(row => row.status !== 'completed' && row.status !== 'cancelled')
        .map(row => ({
            id: row.id,
            task_name: row.name,
            estimated_minutes: Math.round(Number(row.estimated_ms || 0) / 60000),
            elapsed_ms: Number(row.elapsed_ms || 0),
            status: row.status,
            created_at: row.created_at
        }));
}

async function syncPendingQueueToBackend() {
    sortedTasks.forEach(ensureTaskId);
    if (!activeTaskId) setActiveTaskFromCurrentIndex();
    else syncCurrentTaskIndexFromActiveId();

    const openTasks = sortedTasks.filter(
        task => task.status !== 'completed' && !task.timestamps?.completed
    );

    await saveSession();

    const results = await Promise.allSettled(
        openTasks.map((task, index) => {
            const status = task.id === activeTaskId
                ? 'active'
                : task.status === 'blocked'
                    ? 'blocked'
                    : 'pending';

            task.status = status;
            return saveCanonicalTask(task, index + 1, status);
        })
    );

    const failures = results.filter(result => result.status === 'rejected');
    if (failures.length > 0) {
        console.warn(`Failed to sync ${failures.length} canonical task(s).`, failures);
    }

    await saveSession();
}

// Queue removal is obsolete. Completion and cancellation are represented by
// canonical task status updates instead of deleting a duplicate queue row.
async function removeTaskFromQueue() {
    return undefined;
}
