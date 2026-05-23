// ============================================================
//  NextTask — script.js
//  Features: interactive merge sort, task timers, Google Sheets
//  import/export/persistence, actual vs estimated time tracking
// ============================================================

const CLIENT_ID = '181397444268-4ekbmv2vmatdj5cmao6pgsc0348f9h1l.apps.googleusercontent.com';
const SCOPES = 'https://www.googleapis.com/auth/spreadsheets';
const SHEET_NAME = 'NextTask';

// ── State ────────────────────────────────────────────────────
let tasks = [];           // [{name, estimated, startedAt, completedAt, actual}]
let sortedTasks = [];     // same shape, in priority order
let currentTaskIndex = 0;
let deadline = 0;         // unix timestamp (seconds)
let timerInterval = null;
let spareTime = 0;        // cumulative seconds ahead/behind
let taskStartTime = 0;    // unix timestamp when task started
let screenBeforeAdd = ''; // which screen to return to after adding task
let totalComparisons = 0;
let completedComparisons = 0;

// Google auth
let accessToken = null;

// ── Screen management ────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

// ── Status message ───────────────────────────────────────────
function setStatus(msg, color = '') {
  const el = document.getElementById('statusMsg');
  el.textContent = msg;
  el.style.color = color || 'var(--muted)';
}

// ── Google Auth ──────────────────────────────────────────────
function initGoogleAuth() {
  // Wait for GSI library to load
  const checkGsi = setInterval(() => {
    if (typeof google !== 'undefined' && google.accounts) {
      clearInterval(checkGsi);
      google.accounts.id.initialize({
        client_id: CLIENT_ID,
        callback: handleCredentialResponse,
      });
    }
  }, 200);
}

function signIn() {
  const client = google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: SCOPES,
    callback: (tokenResponse) => {
      if (tokenResponse.error) {
        setStatus('Sign-in failed: ' + tokenResponse.error, 'var(--red)');
        return;
      }
      accessToken = tokenResponse.access_token;
      updateAuthUI(true);
      setStatus('Signed in to Google.', 'var(--green)');
    },
  });
  client.requestAccessToken();
}

function signOut() {
  if (accessToken) {
    google.accounts.oauth2.revoke(accessToken, () => {});
  }
  accessToken = null;
  updateAuthUI(false);
  setStatus('Signed out.');
}

function updateAuthUI(isSignedIn) {
  document.getElementById('signInBtn').style.display = isSignedIn ? 'none' : '';
  document.getElementById('signOutBtn').style.display = isSignedIn ? '' : 'none';
  document.getElementById('userInfo').textContent = isSignedIn ? '● connected' : '';
}

document.getElementById('signInBtn').addEventListener('click', signIn);
document.getElementById('signOutBtn').addEventListener('click', signOut);

// ── Sheet Modal ───────────────────────────────────────────────
let sheetModalCallback = null;

function openSheetModal(title, desc, callback) {
  document.getElementById('sheetModalTitle').textContent = title;
  document.getElementById('sheetModalDesc').innerHTML = desc;
  document.getElementById('sheetIdInput').value = '';
  sheetModalCallback = callback;
  document.getElementById('sheetModal').classList.add('open');
}

document.getElementById('sheetModalCancel').addEventListener('click', () => {
  document.getElementById('sheetModal').classList.remove('open');
});

document.getElementById('sheetModalConfirm').addEventListener('click', () => {
  const sheetId = document.getElementById('sheetIdInput').value.trim();
  if (!sheetId) { alert('Please enter a Sheet ID.'); return; }
  document.getElementById('sheetModal').classList.remove('open');
  if (sheetModalCallback) sheetModalCallback(sheetId);
});

// ── Google Sheets API helpers ─────────────────────────────────
async function sheetsGet(sheetId, range) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!res.ok) throw new Error(`Sheets API error: ${res.status} ${await res.text()}`);
  return res.json();
}

async function sheetsUpdate(sheetId, range, values) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ range, majorDimension: 'ROWS', values })
  });
  if (!res.ok) throw new Error(`Sheets API error: ${res.status} ${await res.text()}`);
  return res.json();
}

async function sheetsClear(sheetId, range) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}:clear`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!res.ok) throw new Error(`Sheets clear error: ${res.status}`);
  return res.json();
}

// ── Import from Sheet ─────────────────────────────────────────
document.getElementById('importSheetBtn').addEventListener('click', () => {
  if (!accessToken) {
    alert('Please sign in with Google first.');
    return;
  }
  openSheetModal(
    'Import from Sheet',
    'Paste your Sheet ID. We\'ll read from a tab named <strong>NextTask</strong>.<br>Expected columns: Task | Estimated (min) | Started At | Completed At | Actual (min)',
    async (sheetId) => {
      setStatus('Importing…');
      try {
        const data = await sheetsGet(sheetId, `${SHEET_NAME}!A:E`);
        const rows = data.values || [];
        if (rows.length <= 1) {
          setStatus('Sheet is empty or has only headers.', 'var(--red)');
          return;
        }
        // Skip header row
        const imported = rows.slice(1).map(row => ({
          name: row[0] || '',
          estimated: parseInt(row[1]) || 0,
          startedAt: row[2] || '',
          completedAt: row[3] || '',
          actual: parseFloat(row[4]) || 0,
        })).filter(t => t.name);

        // Populate textarea with task names
        document.getElementById('tasksInput').value = imported.map(t => {
          return t.estimated ? `${t.name} [${t.estimated}min]` : t.name;
        }).join('\n');

        // Store estimated times keyed by name for later use
        window._importedTimings = {};
        imported.forEach(t => {
          window._importedTimings[t.name] = t.estimated;
        });

        setStatus(`Imported ${imported.length} tasks.`, 'var(--green)');
      } catch (e) {
        setStatus('Import failed: ' + e.message, 'var(--red)');
      }
    }
  );
});

// ── Export to Sheet ───────────────────────────────────────────
document.getElementById('exportSheetBtn').addEventListener('click', () => {
  if (!accessToken) {
    alert('Please sign in with Google first.');
    return;
  }
  openSheetModal(
    'Export to Sheet',
    'Paste your Sheet ID. We\'ll write to a tab named <strong>NextTask</strong> (existing data will be replaced).',
    async (sheetId) => {
      setStatus('Exporting…');
      try {
        await sheetsClear(sheetId, `${SHEET_NAME}!A:Z`);
        const header = ['Task', 'Estimated (min)', 'Started At', 'Completed At', 'Actual (min)'];
        const rows = sortedTasks.map(t => [
          t.name,
          t.estimated || '',
          t.startedAt || '',
          t.completedAt || '',
          t.actual || ''
        ]);
        await sheetsUpdate(sheetId, `${SHEET_NAME}!A1`, [header, ...rows]);
        setStatus('Exported successfully!', 'var(--green)');
      } catch (e) {
        // Tab might not exist — try creating it first
        try {
          await createSheetTab(sheetId);
          await sheetsUpdate(sheetId, `${SHEET_NAME}!A1`, [
            ['Task', 'Estimated (min)', 'Started At', 'Completed At', 'Actual (min)'],
            ...sortedTasks.map(t => [t.name, t.estimated || '', t.startedAt || '', t.completedAt || '', t.actual || ''])
          ]);
          setStatus('Exported successfully!', 'var(--green)');
        } catch (e2) {
          setStatus('Export failed: ' + e2.message, 'var(--red)');
        }
      }
    }
  );
});

async function createSheetTab(sheetId) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      requests: [{ addSheet: { properties: { title: SHEET_NAME } } }]
    })
  });
  if (!res.ok) throw new Error(`Could not create sheet tab: ${res.status}`);
}

// ── Task parsing ──────────────────────────────────────────────
function parseTaskInput(raw) {
  // Support optional [Xmin] suffix from import
  return raw.split('\n')
    .map(line => line.trim())
    .filter(line => line)
    .map(line => {
      const match = line.match(/^(.+?)\s*\[(\d+)min\]$/);
      const name = match ? match[1].trim() : line;
      const estimated = match ? parseInt(match[2]) : (window._importedTimings?.[name] || 0);
      return { name, estimated, startedAt: '', completedAt: '', actual: 0 };
    });
}

// ── Sort ──────────────────────────────────────────────────────
document.getElementById('startSortBtn').addEventListener('click', () => {
  const raw = document.getElementById('tasksInput').value.trim();
  if (!raw) { alert('Please enter at least one task.'); return; }
  tasks = parseTaskInput(raw);
  if (tasks.length === 1) {
    sortedTasks = [...tasks];
    showSortedScreen();
  } else {
    // Estimate comparisons for progress bar
    totalComparisons = Math.ceil(tasks.length * Math.log2(tasks.length));
    completedComparisons = 0;
    updateProgress();
    showScreen('compareScreen');
    mergeSortInteractive([...tasks]).then(sorted => {
      sortedTasks = sorted;
      showSortedScreen();
    });
  }
});

function updateProgress() {
  const pct = totalComparisons > 0
    ? Math.min(100, Math.round((completedComparisons / totalComparisons) * 100))
    : 0;
  document.getElementById('progressFill').style.width = pct + '%';
  document.getElementById('progressText').textContent = `${completedComparisons} / ${totalComparisons}`;
}

// ── Merge Sort (async, interactive) ──────────────────────────
async function mergeSortInteractive(array) {
  if (array.length <= 1) return array;
  const mid = Math.floor(array.length / 2);
  const left = await mergeSortInteractive(array.slice(0, mid));
  const right = await mergeSortInteractive(array.slice(mid));
  return mergeInteractive(left, right);
}

function mergeInteractive(left, right) {
  return new Promise(resolve => {
    const result = [];

    function compareNext() {
      if (!left.length && !right.length) { resolve(result); return; }
      if (!left.length) { result.push(...right); resolve(result); return; }
      if (!right.length) { result.push(...left); resolve(result); return; }

      document.getElementById('task1Text').textContent = left[0].name;
      document.getElementById('task2Text').textContent = right[0].name;

      // Replace onclick to avoid stacking listeners
      const btn1 = document.getElementById('task1Btn');
      const btn2 = document.getElementById('task2Btn');

      const newBtn1 = btn1.cloneNode(true);
      const newBtn2 = btn2.cloneNode(true);
      btn1.parentNode.replaceChild(newBtn1, btn1);
      btn2.parentNode.replaceChild(newBtn2, btn2);

      newBtn1.querySelector('#task1Text') || (newBtn1.id = 'task1Btn');
      newBtn2.querySelector('#task2Text') || (newBtn2.id = 'task2Btn');

      document.getElementById('task1Btn').addEventListener('click', () => {
        result.push(left.shift());
        completedComparisons++;
        updateProgress();
        compareNext();
      });

      document.getElementById('task2Btn').addEventListener('click', () => {
        result.push(right.shift());
        completedComparisons++;
        updateProgress();
        compareNext();
      });
    }

    compareNext();
  });
}

// ── Sorted Screen ─────────────────────────────────────────────
function showSortedScreen() {
  const list = document.getElementById('sortedTaskList');
  list.innerHTML = '';
  sortedTasks.forEach((task, i) => {
    const li = document.createElement('li');
    li.innerHTML = `
      <span class="task-rank">${i + 1}</span>
      <span class="task-name">${task.name}</span>
      ${task.estimated ? `<span class="task-time">${task.estimated}m</span>` : ''}
    `;
    list.appendChild(li);
  });
  currentTaskIndex = 0;
  showScreen('sortedScreen');
}

document.getElementById('getToWorkBtn').addEventListener('click', () => {
  if (deadline > 0 && currentTaskIndex < sortedTasks.length) {
    showFocusScreen(); // Resume in-progress task
  } else {
    showDeadlineScreen();
  }
});

document.getElementById('downloadBtn').addEventListener('click', () => {
  const lines = sortedTasks.map((t, i) => {
    let line = `${i + 1}. ${t.name}`;
    if (t.estimated) line += ` [${t.estimated}min]`;
    if (t.actual) line += ` (actual: ${t.actual}min)`;
    return line;
  });
  const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'nexttask-sorted.txt';
  a.click();
});

// ── Add Task ──────────────────────────────────────────────────
function showAddTask(fromScreen) {
  screenBeforeAdd = fromScreen;
  document.getElementById('newTaskInput').value = '';
  showScreen('addTaskScreen');
}

document.getElementById('addTaskBtn').addEventListener('click', () => showAddTask('sortedScreen'));
document.getElementById('addTaskFocusBtn').addEventListener('click', () => {
  clearInterval(timerInterval);
  showAddTask('focusScreen');
});

document.getElementById('cancelAddTaskBtn').addEventListener('click', () => {
  if (screenBeforeAdd === 'focusScreen') {
    // Restart timer
    showFocusScreen();
  } else {
    showScreen('sortedScreen');
  }
});

document.getElementById('saveNewTaskBtn').addEventListener('click', async () => {
  const name = document.getElementById('newTaskInput').value.trim();
  if (!name) { alert('Please enter a task name.'); return; }

  const newTask = { name, estimated: 0, startedAt: '', completedAt: '', actual: 0 };

  // Insert into sorted list and re-sort
  const allTasks = [...sortedTasks, newTask];
  totalComparisons = Math.ceil(allTasks.length * Math.log2(allTasks.length));
  completedComparisons = 0;
  updateProgress();
  showScreen('compareScreen');

  const sorted = await mergeSortInteractive(allTasks);
  sortedTasks = sorted;
  showSortedScreen();
});

// ── Deadline Screen ───────────────────────────────────────────
function showDeadlineScreen() {
  if (currentTaskIndex >= sortedTasks.length) return;
  const task = sortedTasks[currentTaskIndex];
  document.getElementById('deadlineTaskName').textContent = task.name;
  const input = document.getElementById('taskTimeInput');
  input.value = task.estimated || '';
  showScreen('deadlineScreen');
}

document.getElementById('startTaskBtn').addEventListener('click', () => {
  const mins = parseInt(document.getElementById('taskTimeInput').value, 10);
  if (!mins || mins < 1 || mins > 180) {
    alert('Please enter a time between 1 and 180 minutes.');
    return;
  }
  const task = sortedTasks[currentTaskIndex];
  task.estimated = mins;
  deadline = Math.floor(Date.now() / 1000) + mins * 60;
  taskStartTime = Math.floor(Date.now() / 1000);
  task.startedAt = formatDateTime(new Date());
  showFocusScreen();
});

// ── Focus Screen ──────────────────────────────────────────────
function showFocusScreen() {
  if (timerInterval) clearInterval(timerInterval);

  const task = sortedTasks[currentTaskIndex];
  document.getElementById('focusTaskName').textContent = task.name;

  function updateTimer() {
    const now = Math.floor(Date.now() / 1000);
    const remaining = deadline - now;
    const absTime = Math.abs(remaining);
    const mins = Math.floor(absTime / 60);
    const secs = absTime % 60;
    const sign = remaining < 0 ? '-' : '';
    document.getElementById('timerDisplay').textContent =
      `${sign}${mins}:${secs < 10 ? '0' : ''}${secs}`;
    document.getElementById('timerDisplay').style.color =
      remaining >= 0 ? 'var(--green)' : 'var(--red)';
    document.getElementById('timerLabel').textContent =
      remaining >= 0 ? 'remaining' : 'over time';
  }

  updateTimer();
  timerInterval = setInterval(updateTimer, 1000);
  showScreen('focusScreen');
}

document.getElementById('doneNextBtn').addEventListener('click', () => {
  clearInterval(timerInterval);

  const now = Math.floor(Date.now() / 1000);
  const timeDiff = deadline - now;
  spareTime += timeDiff;

  // Record completion data
  const task = sortedTasks[currentTaskIndex];
  task.completedAt = formatDateTime(new Date());
  task.actual = parseFloat(((now - taskStartTime) / 60).toFixed(1));

  deadline = 0;
  currentTaskIndex++;

  if (currentTaskIndex < sortedTasks.length) {
    showDeadlineScreen();
  } else {
    showCompletionScreen();
  }
});

// ── Completion Screen ─────────────────────────────────────────
function showCompletionScreen() {
  const absTime = Math.abs(spareTime);
  const h = Math.floor(absTime / 3600);
  const m = Math.floor((absTime % 3600) / 60);
  const s = absTime % 60;
  const sign = spareTime < 0 ? '-' : '+';
  const formatted = h > 0
    ? `${sign}${h}:${pad(m)}:${pad(s)}`
    : `${sign}${m}:${pad(s)}`;

  document.getElementById('spareTimeDisplay').textContent = formatted;
  document.getElementById('spareTimeDisplay').style.color =
    spareTime >= 0 ? 'var(--green)' : 'var(--red)';
  document.getElementById('spareTimeLabel').textContent =
    spareTime >= 0 ? 'spare time' : 'over schedule';

  showScreen('completionScreen');
}

document.getElementById('startOverBtn').addEventListener('click', () => {
  tasks = [];
  sortedTasks = [];
  currentTaskIndex = 0;
  deadline = 0;
  spareTime = 0;
  taskStartTime = 0;
  document.getElementById('tasksInput').value = '';
  setStatus('');
  showScreen('inputScreen');
});

// ── Helpers ───────────────────────────────────────────────────
function pad(n) { return n < 10 ? '0' + n : '' + n; }

function formatDateTime(date) {
  return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())} ` +
         `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// ── Init ──────────────────────────────────────────────────────
initGoogleAuth();
