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
        // Existing rows predate user ownership. With only one current user,
        // claim those rows once so the migration does not strand their tasks.
        userStore.claimUnownedTasks(req.params.userId);
        res.json({ tasks: userStore.getOpenTasks(req.params.userId) });
    } catch (error) {
        console.error('Failed to load user tasks:', error);
        res.status(500).json({ error: 'Failed to load user tasks', detail: error.message });
    }
});

module.exports = router;
