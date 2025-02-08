const express = require('express');
const passport = require('passport');

const router = express.Router();

// Redirect to Google OAuth
router.get('/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

// Callback URL after successful authentication
router.get('/google/callback',
    passport.authenticate('google', { failureRedirect: '/' }),
    (req, res) => {
        res.redirect('/dashboard'); // Redirect to a dashboard or home page
    }
);

// Logout route
router.get('/logout', (req, res) => {
    req.logout(() => {
        res.redirect('/');
    });
});

module.exports = router;
