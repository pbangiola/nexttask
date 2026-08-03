const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

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

app.use(cors({
    origin(origin, callback) {
        // Requests without an Origin header include Railway health checks,
        // server-to-server requests, and direct browser navigation.
        if (!origin) return callback(null, true);

        const normalizedOrigin = origin.replace(/\/$/, '');
        if (allowedOrigins.has(normalizedOrigin)) {
            return callback(null, true);
        }

        return callback(new Error(`CORS blocked request from ${origin}`));
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type']
}));

app.use(express.json());
app.use(express.static(path.join(__dirname, './')));

app.get('/api/health', (req, res) => {
    res.json({ ok: true, service: 'task-sorter-backend', timestamp: Date.now() });
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

app.post('/api/session/:id/tasks/completed', (req, res) => {
    try {
        const { taskName, estimatedMinutes, actualMinutes, completedAt } = req.body;
        if (!taskName || estimatedMinutes === undefined || actualMinutes === undefined) {
            return res.status(400).json({ error: 'Missing required task log data.' });
        }

        db.logCompletedTask(
            req.params.id,
            taskName,
            parseInt(estimatedMinutes, 10),
            parseInt(actualMinutes, 10),
            completedAt
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to log completed task' });
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

app.use((err, req, res, next) => {
    if (err.message?.startsWith('CORS blocked')) {
        return res.status(403).json({ error: err.message });
    }
    console.error(err);
    res.status(500).json({ error: 'Unexpected server error' });
});

app.listen(PORT, () => {
    console.log(`Task Sorter Server running on port ${PORT}`);
    console.log(`Allowed frontend origins: ${Array.from(allowedOrigins).join(', ')}`);
});
