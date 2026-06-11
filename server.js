const express = require('express');
const { google } = require('googleapis');
const cors = require('cors');
require('dotenv').config();

const app = express();

app.use(cors({
  origin: [
    'https://pbangiola.github.io',
    'http://localhost:3000'
  ]
}));

app.use(express.json());

// Wake-up endpoint triggered immediately on page-load to bypass Render Free Tier latency
app.get('/api/ping', (req, res) => {
  res.json({ status: "awake and ready" });
});

// Primary Sheet generation integration service
app.post('/api/sheets/export', async (req, res) => {
  const { taskList, accessToken } = req.body;
  
  if (!accessToken) {
    return res.status(401).json({ error: "Unauthorized. Missing Google Access Token." });
  }
  if (!taskList || !Array.isArray(taskList)) {
    return res.status(400).json({ error: "Invalid task list data signature." });
  }

  try {
    const authClient = new google.auth.OAuth2();
    authClient.setCredentials({ access_token: accessToken });
    const sheets = google.sheets({ version: 'v4', auth: authClient });

    const spreadsheet = await sheets.spreadsheets.create({
      requestBody: {
        properties: { title: `NextTask Sorted List - ${new Date().toLocaleDateString()}` },
      },
    });

    const spreadsheetId = spreadsheet.data.spreadsheetId;
    const rows = taskList.map((task) => [task]);

    await sheets.spreadsheets.values.update({
      spreadsheetId: spreadsheetId,
      range: 'Sheet1!A1',
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: rows },
    });

    res.json({ url: spreadsheet.data.spreadsheetUrl });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server executing safely on port ${PORT}`);
});