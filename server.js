const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;
const BACKEND_VERSION = 'canonical-tasks-v3';

const defaultAllowedOrigins = [
    'https://pbangiola.github.io',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:5500',
    'http://127.0.0.1:5500'
];

const configuredOrigins = (process.env.FRONTEND_ORIGINS || '')
    .split(',')
    .map(origin => origin.trim().replace(/\/$/, ''))
    .filter(Boolean);

const allowedOrigins = new Set([...defaultAllowedOrigins, ...configuredOrigins]);
const TASK_STATUSES = new Set(['pending', 'active', 'blocked', 'completed', 'cancelled']);

app.use(cors({
    origin(origin, callback) {
        if (!origin) return callback(null, true);
        const normalizedOrigin = origin.replace(/\/$/, '');
        if (allowedOrigins.has(normalizedOrigin)) return callback(null, true);
        return callback(new Error(`CORS blocked request from ${origin}`));
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type']
}));

app.use(express.json());
app.use(express.static(path.join(__dirname, './')));

app.get('/api/health', (req, res) => {
    try {
        db.getTasks('__healthcheck__');
        res.json({
            ok: true,
            service: 'task-sorter-backend',
            version: BACKEND_VERSION,
            capabilities: ['sessions', 'legacy-queue', 'canonical-tasks'],
            canonicalTasksAvailable: true,
            timestamp: Date.now()
        });
    } catch (err) {
        console.error('Canonical task health check failed:', err);
        res.status(500).json({
            ok: false,
            service: 'task-sorter-backend',
            version: BACKEND_VERSION,
            capabilities: ['sessions', 'legacy-queue'],
            canonicalTasksAvailable: false,
            error: err.message,
            timestamp: Date.now()
        });
    }
});

app.get('/api/session/:id', (req, res) => {
    try {
        const sessionState = db.getSession(req.params.id);
        if (!sessionState) return res.status(404).json({ error: 'Session not found' });
        res.json(sessionState);
    } catch (err) {
        res.status(500).json({ error: 'Failed to retrieve session' });
    }
});

app.put('/api/session/:id', (req, res) => {
    try {
        db.saveSession(req.params.id, req.body);
        res.json({ success: true, timestamp: Date.now() });
    } catch (err) {
        res.status(500).json({ error: 'Failed to save session' });
    }
});

app.delete('/api/session/:id', (req, res) => {
    try {
        db.deleteSession(req.params.id);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to clear session' });
    }
});

app.get('/api/session/:id/queue', (req, res) => {
    try {
        res.json({ queue: db.getUncompletedQueue(req.params.id) });
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch task queue' });
    }
});

app.put('/api/session/:id/queue', (req, res) => {
    try {
        const { tasks } = req.body;
        if (!Array.isArray(tasks)) return res.status(400).json({ error: 'Tasks must be an array' });
        db.saveUncompletedQueue(req.params.id, tasks);
        res.json({ success: true, count: tasks.length });
    } catch (err) {
        res.status(500).json({ error: 'Failed to update task queue' });
    }
});

app.post('/api/session/:id/queue/remove', (req, res) => {
    try {
        const { taskName } = req.body;
        if (!taskName) return res.status(400).json({ error: 'taskName is required' });
        db.removeFromQueue(req.params.id, taskName);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to remove task from queue' });
    }
});

// Legacy analytics logging is best-effort only. Canonical task completion is
// authoritative and must not fail because the old completed_tasks table rejects
// an insert during migration.
app.post('/api/session/:id/tasks/completed', (req, res) => {
    const { taskName, estimatedMinutes, actualMinutes, completedAt } = req.body;
    if (!taskName || estimatedMinutes === undefined || actualMinutes === undefined) {
        return res.status(400).json({ error: 'Missing required task log data.' });
    }

    try {
        db.logCompletedTask(
            req.params.id,
            taskName,
            parseInt(estimatedMinutes, 10),
            parseInt(actualMinutes, 10),
            completedAt
        );
        return res.json({ success: true, legacyAnalyticsLogged: true });
    } catch (err) {
        console.warn('Legacy completion analytics write skipped:', {
            sessionId: req.params.id,
            taskName,
            error: err.message
        });
        return res.status(202).json({
            success: true,
            legacyAnalyticsLogged: false,
            warning: err.message
        });
    }
});

app.get('/api/session/:id/stats', (req, res) => {
    try {
        const history = db.getUserTaskHistory(req.params.id);
        const summary = db.getUserAggregateStats(req.params.id);
        res.json({
            summary: summary || {
                total_tasks_completed: 0,
                total_estimated_minutes: 0,
                total_actual_minutes: 0,
                total_variance_minutes: 0,
                avg_variance_per_task: 0
            },
            history
        });
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch user statistics' });
    }
});

app.get('/api/session/:id/tasks', (req, res) => {
    try {
        const status = req.query.status || null;
        if (status && !TASK_STATUSES.has(status)) {
            return res.status(400).json({ error: 'Invalid task status' });
        }
        res.json({ tasks: db.getTasks(req.params.id, status) });
    } catch (err) {
        console.error('Failed to fetch canonical tasks:', err);
        res.status(500).json({ error: 'Failed to fetch tasks', detail: err.message });
    }
});

app.get('/api/session/:id/tasks/:taskId', (req, res) => {
    try {
        const task = db.getTask(req.params.id, req.params.taskId);
        if (!task) return res.status(404).json({ error: 'Task not found' });
        res.json({ task });
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch task', detail: err.message });
    }
});

app.put('/api/session/:id/tasks/:taskId', (req, res) => {
    try {
        const task = { ...req.body, id: req.params.taskId };
        if (!task.name || !String(task.name).trim()) {
            return res.status(400).json({ error: 'Task name is required' });
        }
        if (task.status && !TASK_STATUSES.has(task.status)) {
            return res.status(400).json({ error: 'Invalid task status' });
        }
        res.json({ task: db.upsertTask(req.params.id, task) });
    } catch (err) {
        console.error('Failed to save canonical task:', err);
        res.status(500).json({ error: 'Failed to save task', detail: err.message });
    }
});

app.patch('/api/session/:id/tasks/:taskId', (req, res) => {
    try {
        if (req.body.status && !TASK_STATUSES.has(req.body.status)) {
            return res.status(400).json({ error: 'Invalid task status' });
        }
        const task = db.updateTask(req.params.id, req.params.taskId, req.body);
        if (!task) return res.status(404).json({ error: 'Task not found' });
        res.json({ task });
    } catch (err) {
        console.error('Failed to update canonical task:', err);
        res.status(500).json({ error: 'Failed to update task', detail: err.message });
    }
});

app.post('/api/session/:id/tasks/:taskId/complete', (req, res) => {
    try {
        const task = db.completeTask(req.params.id, req.params.taskId, req.body.completedAt || Date.now());
        if (!task) return res.status(404).json({ error: 'Task not found' });
        res.json({ task });
    } catch (err) {
        console.error('Failed to complete canonical task:', err);
        res.status(500).json({ error: 'Failed to complete task', detail: err.message });
    }
});

app.post('/api/session/:id/tasks/:taskId/block', (req, res) => {
    try {
        const blocker = req.body.blocker;
        if (!blocker || !blocker.id || !blocker.name) {
            return res.status(400).json({ error: 'blocker.id and blocker.name are required' });
        }
        const result = db.blockAndRequeueTasks(req.params.id, req.params.taskId, blocker);
        if (!result) return res.status(404).json({ error: 'Blocked task not found' });
        res.json(result);
    } catch (err) {
        console.error('Failed to block canonical task:', err);
        res.status(500).json({ error: 'Failed to block and requeue tasks', detail: err.message });
    }
});

app.use((err, req, res, next) => {
    if (err.message?.startsWith('CORS blocked')) {
        return res.status(403).json({ error: err.message });
    }
    console.error(err);
    res.status(500).json({ error: 'Unexpected server error' });
});

app.listen(PORT, () => {
    console.log(`Task Sorter Server ${BACKEND_VERSION} running on port ${PORT}`);
    console.log(`Allowed frontend origins: ${Array.from(allowedOrigins).join(', ')}`);
});
