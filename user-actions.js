// Stable anonymous identity and user-owned task resume behavior.
const userId = (() => {
    const storageKey = 'taskSorterUserId';
    const existing = localStorage.getItem(storageKey);
    if (existing) return existing;

    const randomPart = typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2, 11);
    const created = `user_${randomPart}`;
    localStorage.setItem(storageKey, created);
    return created;
})();

async function ensureCurrentUser() {
    const response = await fetch(apiUrl(`/api/users/${encodeURIComponent(userId)}`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
    });

    if (!response.ok) {
        const detail = await response.text();
        throw new Error(`User save failed (${response.status}): ${detail}`);
    }
}

// Canonical tasks now belong to a user as well as retaining their session
// provenance. Override the migration writer before the workflow loads.
saveCanonicalTask = async function saveUserOwnedCanonicalTask(task, sortOrder, status = task.status || 'pending') {
    const payload = {
        ...toCanonicalTask(task, sortOrder, status),
        userId
    };

    await ensureCurrentUser();

    const response = await fetch(apiUrl(`/api/session/${sessionId}/tasks/${encodeURIComponent(payload.id)}`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        const detail = await response.text();
        throw new Error(`Canonical task save failed (${response.status}): ${detail}`);
    }

    return response.json();
};

// Resume creates a new work session from this user's unfinished tasks. It does
// not reopen the prior session or depend on the current random session ID.
fetchExistingQueue = async function fetchUserOwnedOpenTasks() {
    try {
        await ensureCurrentUser();

        // Create the new session first so SQLite's session foreign key remains valid
        // when open tasks are moved into it.
        const sessionResponse = await fetch(apiUrl(`/api/session/${sessionId}`), {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                userId,
                sortedTasks: [],
                activeTaskId: null,
                currentTaskIndex: 0,
                deadline: 0,
                spareTime: 0,
                taskStartTimestamp: 0,
                pausedSecondsRemaining: 0,
                totalAvailableTime: 0,
                endConstraint: '',
                sessionStartTimestamp: Date.now(),
                currentStepStartTimestamp: Date.now(),
                activeView: 'work-choice'
            })
        });

        if (!sessionResponse.ok) {
            throw new Error(`New session save failed (${sessionResponse.status})`);
        }

        const response = await fetch(apiUrl(`/api/users/${encodeURIComponent(userId)}/tasks/import`), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId })
        });

        if (!response.ok) {
            const detail = await response.text();
            throw new Error(`User task import failed (${response.status}): ${detail}`);
        }

        const data = await response.json();
        return (data.tasks || []).map(row => ({
            id: row.id,
            task_name: row.name,
            estimated_minutes: Math.round(Number(row.estimated_ms || 0) / 60000),
            elapsed_ms: Number(row.elapsed_ms || 0),
            status: row.status,
            created_at: row.created_at
        }));
    } catch (error) {
        console.error('Failed to resume user tasks:', error);
        return [];
    }
};

ensureCurrentUser().catch(error => {
    console.warn('User initialization will retry on the next save:', error);
});
