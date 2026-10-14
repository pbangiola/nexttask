const express = require('express');
const cors = require('cors');
const { clerkMiddleware, getAuth } = require('@clerk/express');
const db = require('./database');
const userStore = require('./user-store');
const userRoutes = require('./user-routes');
const taskGraphRoutes = require('./task-graph-routes');
const publicAssets = require('./public-assets');

function createApp(clerkOptions = {}) {
    const app = express();
    const BACKEND_VERSION = 'nexttask-integrated-beta-1';

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
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization']
    }));

    app.use(express.json({ limit: '1mb' }));
    publicAssets(app);

    app.get('/api/config', (req, res) => {
        const publishableKey = process.env.CLERK_PUBLISHABLE_KEY;
        if (!publishableKey) return res.status(500).json({ error: 'Clerk publishable key is not configured' });
        return res.json({ clerkPublishableKey: publishableKey });
    });

    function requireClerkUser(req, res, next) {
        const auth = getAuth(req);
        if (!auth.isAuthenticated || !auth.userId) return res.status(401).json({ error: 'Unauthorized' });
        req.clerkUserId = auth.userId;
        return next();
    }

    function requireOwnSession(req, res, next) {
        if (String(req.params.id) !== String(req.clerkUserId)) {
            return res.status(403).json({ error: 'Session does not belong to authenticated user' });
        }
        return next();
    }

    app.get('/api/health', (req, res) => {
        try {
            db.ensureSession('__healthcheck__');
            userStore.ensureUser('__healthcheck__');
            res.json({
                ok: true,
                service: 'task-sorter-backend',
                version: BACKEND_VERSION,
                capabilities: [
                    'users', 'sessions', 'full-task-list-sync', 'incomplete-task-resume',
                    'unfinished-task-prepend', 'hierarchical-task-nodes', 'project-tree-crud',
                    'recursive-work-flattening', 'structural-blocker-flow',
                    'durable-work-sessions', 'ranked-session-items', 'work-interval-history'
                ],
                timestamp: Date.now()
            });
        } catch (error) {
            console.error('Backend health check failed:', error);
            res.status(500).json({ ok: false, error: error.message, timestamp: Date.now() });
        }
    });

    // Authenticate only the private API surface. Public diagnostics and denied
    // static paths never depend on Clerk being configured or reachable.
    app.use('/api', (req, res, next) => {
        if (!req.headers.authorization && !req.headers.cookie) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        return next();
    }, clerkMiddleware(clerkOptions), requireClerkUser);
    app.use('/api', userRoutes);
    app.use('/api', taskGraphRoutes);

    app.get('/api/session/:id', requireClerkUser, requireOwnSession, (req, res) => {
        try { res.json(db.getSession(req.params.id)); }
        catch (error) { res.status(500).json({ error: 'Failed to retrieve session', detail: error.message }); }
    });

    app.get('/api/session/:id/tasks', requireClerkUser, requireOwnSession, (req, res) => {
        try {
            const incompleteOnly = req.query.incomplete === '1' || req.query.incomplete === 'true';
            res.json({ tasks: db.getTasks(req.params.id, incompleteOnly) });
        } catch (error) {
            res.status(500).json({ error: 'Failed to fetch tasks', detail: error.message });
        }
    });

    app.put('/api/session/:id/tasks', requireClerkUser, requireOwnSession, (req, res) => {
        try {
            const tasks = req.body.tasks;
            if (!Array.isArray(tasks)) return res.status(400).json({ error: 'tasks must be an array' });
            const userId = req.clerkUserId;
            userStore.ensureUser(userId);
            const ownedTasks = tasks.map(task => ({ ...task, userId }));
            const savedTasks = db.saveTaskList(userId, ownedTasks, {
                totalAvailableTimeMs: req.body.totalAvailableTimeMs,
                endConstraint: req.body.endConstraint
            });
            // Queue rank belongs to work_session_items, never canonical position.
            return res.json({ success: true, count: savedTasks.length, timestamp: Date.now() });
        } catch (error) {
            console.error('Failed to save task list:', error);
            return res.status(400).json({ error: 'Failed to save task list', detail: error.message });
        }
    });

    app.get('/api/session/:id/stats', requireClerkUser, requireOwnSession, (req, res) => {
        try { res.json({ summary: db.getStats(req.params.id) }); }
        catch (error) { res.status(500).json({ error: 'Failed to fetch statistics', detail: error.message }); }
    });

    app.use((error, req, res, next) => {
        if (error.message?.startsWith('CORS blocked')) return res.status(403).json({ error: error.message });
        console.error(error);
        return res.status(500).json({ error: 'Unexpected server error' });
    });

    app.use((req, res) => res.status(404).json({ error: 'Not found' }));
    return app;
}

if (require.main === module) {
    const PORT = process.env.PORT || 3000;
    createApp().listen(PORT, () => {
        console.log(`Task Sorter graph foundation running on port ${PORT}`);
    });
}

module.exports = { createApp };
