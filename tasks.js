const express = require('express');
const { google } = require('googleapis');
require('dotenv').config();

const router = express.Router();

const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT), 
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
});

const sheets = google.sheets({ version: 'v4', auth });

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;
const SHEET_NAME = 'Tasks';

// Get tasks from Google Sheets
router.get('/tasks', async (req, res) => {
    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: SHEET_NAME,
        });
        res.json(response.data.values || []);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Save tasks to Google Sheets
router.post('/tasks', async (req, res) => {
    try {
        const { tasks } = req.body;
        await sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID,
            range: SHEET_NAME,
            valueInputOption: 'RAW',
            requestBody: { values: tasks.map(task => [task]) }
        });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
