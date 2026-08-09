const express = require('express');
const userStore = require('./user-store');

const router = express.Router();

router.put('/users/:userId', (req, res) => {
    try {
        userStore.ensureUser(req.params.userId);
        res.json({ success: true, userId: req.params.userId });
    } catch (error) {
        console.error('Failed to ensure user:', error);
        res.status(500).json({ error: 'Failed to save user', detail: error.message });
    }
});

router.get('/users/:userId/tasks', (req, res) => {
    try {
        userStore.claimUnownedTasks(req.params.userId);
        res.json({ tasks: userStore.getOpenTasks(req.params.userId) });
    } catch (error) {
        console.error('Failed to load user tasks:', error);
        res.status(500).json({ error: 'Failed to load user tasks', detail: error.message });
    }
});

router.post('/users/:userId/tasks/import', (req, res) => {
    try {
        const { sessionId } = req.body;
        if (!sessionId) {
            return res.status(400).json({ error: 'sessionId is required' });
        }

        const tasks = userStore.importOpenTasksIntoSession(req.params.userId, sessionId);
        res.json({ tasks, sessionId });
    } catch (error) {
        console.error('Failed to import user tasks:', error);
        res.status(500).json({ error: 'Failed to import user tasks', detail: error.message });
    }
});

module.exports = router;
