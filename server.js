const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Session endpoints
app.get('/api/session/:id', (req, res) => {
    try {
        const state = db.getSession(req.params.id);
        res.json({ success: true, state });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/session/:id', (req, res) => {
    try {
        db.saveSession(req.params.id, req.body.state);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/session/:id', (req, res) => {
    try {
        db.clearSession(req.params.id);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Queue persistence endpoints
app.get('/api/session/:id/queue', (req, res) => {
    try {
        const queue = db.getQueue(req.params.id);
        res.json({ success: true, queue });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/session/:id/queue/prepend', (req, res) => {
    try {
        const { uncompletedTasks } = req.body;
        db.prependToQueue(req.params.id, uncompletedTasks || []);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Completed task log endpoint
app.post('/api/session/:id/tasks/completed', (req, res) => {
    try {
        const { taskName, estimatedTime, actualTimeMs } = req.body;
        db.logCompletedTask(req.params.id, taskName, estimatedTime, actualTimeMs);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/session/:id/stats', (req, res) => {
    try {
        const stats = db.getStats(req.params.id);
        res.json({ success: true, stats });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, () => {
    console.log(`Task Sorter server active on port ${PORT}`);
});
