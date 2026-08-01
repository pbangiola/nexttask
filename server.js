const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// -----------------------------------------------------------------------------
// ROUTES
// -----------------------------------------------------------------------------

// GET ALL TASKS (Ordered by position ASC)
app.get('/api/tasks', (req, res) => {
  try {
    const tasks = db.prepare('SELECT * FROM tasks ORDER BY position ASC, id ASC').all();
    res.json(tasks);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// CREATE NEW TASK
app.post('/api/tasks', (req, res) => {
  const { text } = req.body;
  
  if (!text || !text.trim()) {
    return res.status(400).json({ error: 'Task text is required.' });
  }

  try {
    // Get the highest position currently in the list
    const maxPosResult = db.prepare('SELECT MAX(position) AS maxPos FROM tasks').get();
    const nextPosition = (maxPosResult.maxPos !== null) ? maxPosResult.maxPos + 1 : 0;
    const now = new Date().toISOString();

    const insertStmt = db.prepare(`
      INSERT INTO tasks (text, completed, position, created_at, updated_at)
      VALUES (?, 0, ?, ?, ?)
    `);

    const result = insertStmt.run(text.trim(), nextPosition, now, now);

    const newTask = db.prepare('SELECT * FROM tasks WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(newTask);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// UPDATE TASK STATUS OR TEXT
app.patch('/api/tasks/:id', (req, res) => {
  const { id } = req.params;
  const { text, completed } = req.body;

  try {
    const existingTask = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
    if (!existingTask) {
      return res.status(404).json({ error: 'Task not found.' });
    }

    const updatedText = text !== undefined ? text.trim() : existingTask.text;
    const updatedCompleted = completed !== undefined ? (completed ? 1 : 0) : existingTask.completed;
    const now = new Date().toISOString();

    const updateStmt = db.prepare(`
      UPDATE tasks 
      SET text = ?, completed = ?, updated_at = ? 
      WHERE id = ?
    `);

    updateStmt.run(updatedText, updatedCompleted, now, id);

    const updatedTask = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
    res.json(updatedTask);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// REORDER TASKS (Batch update positions)
app.put('/api/tasks/reorder', (req, res) => {
  const { orderedIds } = req.body; // Expects an array of IDs: [3, 1, 2]

  if (!Array.isArray(orderedIds)) {
    return res.status(400).json({ error: 'orderedIds array is required.' });
  }

  try {
    const now = new Date().toISOString();
    const updatePositionStmt = db.prepare(`
      UPDATE tasks SET position = ?, updated_at = ? WHERE id = ?
    `);

    // Run batch updates inside a transaction for atomicity
    const reorderTransaction = db.transaction((ids) => {
      ids.forEach((id, index) => {
        updatePositionStmt.run(index, now, id);
      });
    });

    reorderTransaction(orderedIds);

    const updatedTasks = db.prepare('SELECT * FROM tasks ORDER BY position ASC').all();
    res.json(updatedTasks);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE TASK
app.delete('/api/tasks/:id', (req, res) => {
  const { id } = req.params;

  try {
    const deleteStmt = db.prepare('DELETE FROM tasks WHERE id = ?');
    const result = deleteStmt.run(id);

    if (result.changes === 0) {
      return res.status(404).json({ error: 'Task not found.' });
    }

    res.json({ success: true, id: Number(id) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// START SERVER
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
