const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./database');
const userStore = require('./user-store');
const userRoutes = require('./user-routes');

const app = express();
const PORT = process.env.PORT || 3000;
const BACKEND_VERSION = 'canonical-task-list-v2';

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
        if (!origin) return callback(null, true);
        const normalizedOrigin = origin.replace(/\/$/, '');
        if (allowedOrigins.has(normalizedOrigin)) return callback(null, true);
        return callback(new Error(`CORS blocked request from ${origin}`));
    },
    methods: ['GET', 'POST', 'PUT', 'OPTIONS'],
    allowedHeaders: ['Content-Type']
}));

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, './')));
app.use('/api', userRoutes);

app.get('/api/health', (req, res) => {
    try {
        db.ensureSession('__healthcheck__');
        userStore.ensureUser('__healthcheck__');
        res.json({
            ok: true,
            service: 'task-sorter-backend',
            version: BACKEND_VERSION,
            capabilities: ['users', 'sessions', 'full-task-list-sync', 'incomplete-task-resume'],
            timestamp: Date.now()
        });
    } catch (error) {
        console.error('Backend health check failed:', error);
        res.status(500).json({ ok: false, error: error.message, timestamp: Date.now() });
    }
});

app.get('/api/session/:id', (req, res) => {
    try {
        res.json(db.getSession(req.params.id));
    } catch (error) {
        res.status(500).json({ error: 'Failed to retrieve session', detail: error.message });
    }
});

app.get('/api/session/:id/tasks', (req, res) => {
    try {
        const incompleteOnly = req.query.incomplete === '1' || req.query.incomplete === 'true';
        res.json({ tasks: db.getTasks(req.params.id, incompleteOnly) });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch tasks', detail: error.message });
    }
});

app.put('/api/session/:id/tasks', (req, res) => {
    try {
        const tasks = req.body.tasks;
        if (!Array.isArray(tasks)) {
            return res.status(400).json({ error: 'tasks must be an array' });
        }

        if (req.body.userId) userStore.ensureUser(req.body.userId);

        const savedTasks = db.saveTaskList(req.params.id, tasks, {
            totalAvailableTimeMs: req.body.totalAvailableTimeMs,
            endConstraint: req.body.endConstraint
        });

        if (req.body.userId) {
            tasks.forEach(task => {
                if (task.id) userStore.attachTask(req.body.userId, task.id);
            });
        }

        return res.json({
            success: true,
            count: savedTasks.length,
            timestamp: Date.now()
        });
    } catch (error) {
        console.error('Failed to save task list:', error);
        return res.status(500).json({ error: 'Failed to save task list', detail: error.message });
    }
});

app.get('/api/session/:id/stats', (req, res) => {
    try {
        res.json({ summary: db.getStats(req.params.id) });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch statistics', detail: error.message });
    }
});

app.use((error, req, res, next) => {
    if (error.message?.startsWith('CORS blocked')) {
        return res.status(403).json({ error: error.message });
    }
    console.error(error);
    return res.status(500).json({ error: 'Unexpected server error' });
});

app.listen(PORT, () => {
    console.log(`Task Sorter Server ${BACKEND_VERSION} running on port ${PORT}`);
});
