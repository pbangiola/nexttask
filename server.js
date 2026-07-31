const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Fetch existing session state
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

// Save / sync full session state
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

// Clear active session
app.delete('/api/session/:id', (req, res) => {
    try {
        db.deleteSession(req.params.id);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to clear session' });
    }
});

app.listen(PORT, () => {
    console.log(`Task Sorter Backend running on http://localhost:${PORT}`);
});
