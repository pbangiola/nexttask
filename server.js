const express = require('express');
const path = require('path');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ----------------------------------------------------
// Session API Endpoints (Supporting script.js)
// ----------------------------------------------------

// GET /api/session/:sessionId - Retrieve session state
app.get('/api/session/:sessionId', (req, res) => {
  try {
    const { sessionId } = req.params;
    const row = db.prepare('SELECT state FROM sessions WHERE session_id = ?').get(sessionId);
    
    if (!row) {
      return res.status(404).json({ error: 'Session not found' });
    }
    
    res.json(JSON.parse(row.state));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/session/:sessionId - Sync session state to backend
app.put('/api/session/:sessionId', (req, res) => {
  try {
    const { sessionId } = req.params;
    const statePayload = JSON.stringify(req.body);

    const stmt = db.prepare(`
      INSERT INTO sessions (session_id, state, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(session_id) DO UPDATE SET
        state = excluded.state,
        updated_at = CURRENT_TIMESTAMP
    `);
    stmt.run(sessionId, statePayload);

    res.json({ success: true, sessionId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/session/:sessionId - Clear session state
app.delete('/api/session/:sessionId', (req, res) => {
  try {
    const { sessionId } = req.params;
    db.prepare('DELETE FROM sessions WHERE session_id = ?').run(sessionId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/session/:sessionId/tasks/completed - Log completed tasks with metrics
app.post('/api/session/:sessionId/tasks/completed', (req, res) => {
  try {
    const { sessionId } = req.params;
    const { taskName, estimatedTime, actualTimeMs } = req.body;

    const stmt = db.prepare(`
      INSERT INTO task_logs (session_id, task_name, estimated_time, actual_time_ms)
      VALUES (?, ?, ?, ?)
    `);
    stmt.run(sessionId, taskName, estimatedTime || null, actualTimeMs || null);

    res.status(201).json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/session/:sessionId/queue/prepend - Prepend task to session queue
app.post('/api/session/:sessionId/queue/prepend', (req, res) => {
  try {
    const { sessionId } = req.params;
    const { task } = req.body;

    const row = db.prepare('SELECT state FROM sessions WHERE session_id = ?').get(sessionId);
    let state = row ? JSON.parse(row.state) : { queue: [] };

    state.queue = state.queue || [];
    state.queue.unshift(task);

    const stmt = db.prepare(`
      INSERT INTO sessions (session_id, state, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(session_id) DO UPDATE SET
        state = excluded.state,
        updated_at = CURRENT_TIMESTAMP
    `);
    stmt.run(sessionId, JSON.stringify(state));

    res.json({ success: true, queue: state.queue });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------
// Standard Task REST Endpoints
// ----------------------------------------------------

app.get('/api/tasks', (req, res) => {
  try {
    const tasks = db.prepare('SELECT * FROM tasks ORDER BY position ASC').all();
    res.json(tasks);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/tasks', (req, res) => {
  try {
    const { id, text, position } = req.body;
    const stmt = db.prepare('INSERT INTO tasks (id, text, position) VALUES (?, ?, ?)');
    stmt.run(id, text, position || 0);
    res.status(201).json({ id, text, position });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Fallback route to serve index.html for single-page client routing
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});