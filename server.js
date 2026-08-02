const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Fallback static file serving for root deployment assets
app.use(express.static(path.join(__dirname, './')));

// --- Active Session Management Endpoints ---

app.get('/api/session/:id', (req, res) => {
    try {
        const sessionState = db.getSession(req.params.id);
        if (!sessionState) {
            return res.status(404).json({ error: 'Session not found' });
        }
        res.json(sessionState);
    } catch (err) {
        res.status(500).json({ error: 'Failed to retrieve session' });
    }
});

app.put('/api/session/:id', (req, res) => {
    try {
        const { id } = req.params;
        const state = req.body;
        db.saveSession(id, state);
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

// --- Uncompleted Tasks Queue Endpoints ---

// Get persistent uncompleted master task queue
app.get('/api/session/:id/queue', (req, res) => {
    try {
        const queue = db.getUncompletedQueue(req.params.id);
        res.json({ queue });
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch task queue' });
    }
});

// Save or replace task queue directly
app.put('/api/session/:id/queue', (req, res) => {
    try {
        const sessionId = req.params.id;
        const { tasks } = req.body;

        if (!Array.isArray(tasks)) {
            return res.status(400).json({ error: 'Tasks must be an array' });
        }

        db.saveUncompletedQueue(sessionId, tasks);
        res.json({ success: true, count: tasks.length });
    } catch (err) {
        res.status(500).json({ error: 'Failed to update task queue' });
    }
});

// Prepend uncompleted tasks to front of existing master task queue
app.post('/api/session/:id/queue/prepend', (req, res) => {
    try {
        const sessionId = req.params.id;
        const { uncompletedTasks } = req.body;

        if (!Array.isArray(uncompletedTasks)) {
            return res.status(400).json({ error: 'uncompletedTasks must be an array' });
        }

        db.prependUncompletedTasks(sessionId, uncompletedTasks);
        const updatedQueue = db.getUncompletedQueue(sessionId);

        res.json({ success: true, queue: updatedQueue });
    } catch (err) {
        res.status(500).json({ error: 'Failed to prepend uncompleted tasks' });
    }
});

// --- User Performance Tracking & Analytics Endpoints ---

// Log a completed task event to the permanent record
app.post('/api/session/:id/tasks/completed', (req, res) => {
    try {
        const sessionId = req.params.id;
        const { taskName, estimatedMinutes, actualMinutes, completedAt } = req.body;

        if (!taskName || estimatedMinutes === undefined || actualMinutes === undefined) {
            return res.status(400).json({ error: 'Missing required task log data.' });
        }

        db.logCompletedTask(
            sessionId,
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

// Fetch historical task log and aggregate metrics for a session ID
app.get('/api/session/:id/stats', (req, res) => {
    try {
        const sessionId = req.params.id;
        const history = db.getUserTaskHistory(sessionId);
        const summary = db.getUserAggregateStats(sessionId);

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

app.listen(PORT, () => {
    console.log(`Task Sorter Server running on port ${PORT}`);
});
