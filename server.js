const express = require('express');
const { google } = require('googleapis');
const cors = require('cors'); // Required to allow your GitHub Pages site to talk to Render
const app = express();

app.use(cors({ origin: 'https://yourusername.github.io' })); // Whitelist your GitHub Pages domain
app.use(express.json());

// A simple ping endpoint your frontend calls immediately on page load to wake up the server
app.get('/api/ping', (req, res) => {
  res.json({ status: "awake" });
});

app.post('/api/sheets/export', async (req, res) => {
  const { taskList, accessToken } = req.body; // Frontend passes the token down manually now
  
  if (!accessToken) return res.status(401).json({ error: "Missing token" });

  try {
    const authClient = new google.auth.OAuth2();
    authClient.setCredentials({ access_token: accessToken });
    const sheets = google.sheets({ version: 'v4', auth: authClient });

    const spreadsheet = await sheets.spreadsheets.create({
      requestBody: {
        properties: { title: `NextTask List - ${new Date().toLocaleDateString()}` },
      },
    });

    const rows = taskList.map((task) => [task]);
    await sheets.spreadsheets.values.update({
      spreadsheetId: spreadsheet.data.spreadsheetId,
      range: 'Sheet1!A1',
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: rows },
    });

    res.json({ url: spreadsheet.data.spreadsheetUrl });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(process.env.PORT || 3001);