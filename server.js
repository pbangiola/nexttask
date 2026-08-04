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

// ==========================================
// USER TASK QUEUE ENDPOINTS
// ==========================================

// Get uncompleted task queue for a specific user
app.get('/api/users/:userId/tasks', (req, res) => {
    try {
        const { userId } = req.params;
        const tasks = db.getUncompletedQueue(parseInt(userId, 10));
        res.json({ tasks });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch task queue' });
    }
});

// Add a new task to a user's queue
app.post('/api/users/:userId/tasks', (req, res) => {
    try {
        const userId = parseInt(req.params.userId, 10);
        const { taskName, projectId, estimatedMinutes, elapsedMs, sortOrder, dueAt } = req.body;

        if (!taskName) {
            return res.status(400).json({ error: 'taskName is required' });
        }

        const taskId = db.addTask(
            userId,
            taskName,
            projectId || null,
            estimatedMinutes || 10,
            elapsedMs || 0,
            sortOrder || 1,
            dueAt || null
        );

        res.status(201).json({ success: true, taskId });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to add task' });
    }
});

// Mark a task as completed
app.patch('/api/users/:userId/tasks/:taskId/complete', (req, res) => {
    try {
        const userId = parseInt(req.params.userId, 10);
        const taskId = parseInt(req.params.taskId, 10);
        const { completedAt } = req.body;

        db.completeTask(taskId, userId, completedAt || Date.now());
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to complete task' });
    }
});

// ==========================================
// USER PROJECT ENDPOINTS
// ==========================================

// Get all projects for a user
app.get('/api/users/:userId/projects', (req, res) => {
    try {
        const userId = parseInt(req.params.userId, 10);
        const projects = db.getUserProjects(userId);
        res.json({ projects });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch user projects' });
    }
});

// Create a new project for a user
app.post('/api/users/:userId/projects', (req, res) => {
    try {
        const userId = parseInt(req.params.userId, 10);
        const { projectName, priority, parentProject } = req.body;

        if (!projectName) {
            return res.status(400).json({ error: 'projectName is required' });
        }

        const projectId = db.createProject(projectName, userId, priority || null, parentProject || null);
        res.status(201).json({ success: true, projectId });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to create project' });
    }
});

// ==========================================
// USER ANALYTICS & STATS ENDPOINTS
// ==========================================

// Get aggregate statistics for a user
app.get('/api/users/:userId/stats', (req, res) => {
    try {
        const userId = parseInt(req.params.userId, 10);
        const summary = db.getUserAggregateStats(userId);

        res.json({
            summary: summary || {
                total_tasks_completed: 0,
                total_estimated_minutes: 0,
                total_actual_minutes: 0
            }
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch user statistics' });
    }
});

// ==========================================
// SESSION MANAGEMENT ENDPOINTS
// ==========================================

// Get session state by ID
app.get('/api/sessions/:id', (req, res) => {
    try {
        const session = db.getSession(req.params.id);
        if (!session) {
            return res.status(404).json({ error: 'Session not found' });
        }
        res.json(session);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to retrieve session' });
    }
});

// Create or update a session
app.put('/api/sessions/:id', (req, res) => {
    try {
        const sessionId = req.params.id;
        const { userId, sessionStart, hardstop, hardstopReason, softstop, sessionEnd } = req.body;

        if (!userId) {
            return res.status(400).json({ error: 'userId is required for session tracking' });
        }

        db.saveSession({
            sessionid: sessionId,
            userid: parseInt(userId, 10),
            session_start: sessionStart || Date.now(),
            hardstop: hardstop || null,
            hardstop_reason: hardstopReason || null,
            softstop: softstop || null,
            session_end: sessionEnd || null
        });

        res.json({ success: true, timestamp: Date.now() });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to save session' });
    }
});

// Delete a session
app.delete('/api/sessions/:id', (req, res) => {
    try {
        db.deleteSession(req.params.id);
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to clear session' });
    }
});

// ==========================================
// SERVER INITIALIZATION
// ==========================================

app.listen(PORT, () => {
    console.log(`Task Sorter Server running on port ${PORT}`);
});
