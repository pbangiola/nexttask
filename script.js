// ============================================================
//  NextTask — script.js
// ============================================================

const CLIENT_ID = '181397444268-4ekbmv2vmatdj5cmao6pgsc0348f9h1l.apps.googleusercontent.com';
const SCOPES = 'https://www.googleapis.com/auth/spreadsheets';
const SHEET_NAME = 'NextTask';

// ── State ────────────────────────────────────────────────────
let sortedTasks = [];
let currentTaskIndex = 0;
let deadline = 0;
let timerInterval = null;
let spareTime = 0;
let taskStartTime = 0;
let screenBeforeAdd = '';
let totalComparisons = 0;
let completedComparisons = 0;
let accessToken = null;
let sheetModalCallback = null;

// ── Helpers ───────────────────────────────────────────────────
function pad(n) { return n < 10 ? '0' + n : '' + n; }
function formatDateTime(date) {
  return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
function setStatus(msg, color) {
  const el = document.getElementById('statusMsg');
  el.textContent = msg;
  el.style.color = color || 'var(--muted)';
}
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

// ── Google Auth ──────────────────────────────────────────────
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
      document.getElementById('signInBtn').style.display = 'none';
      document.getElementById('signOutBtn').style.display = '';
      document.getElementById('userInfo').textContent = '● connected';
      setStatus('Signed in to Google.', 'var(--green)');
    },
  });
  client.requestAccessToken();
}

function signOut() {
  if (accessToken) google.accounts.oauth2.revoke(accessToken, () => {});
  accessToken = null;
  document.getElementById('signInBtn').style.display = '';
  document.getElementById('signOutBtn').style.display = 'none';
  document.getElementById('userInfo').textContent = '';
  setStatus('Signed out.');
}

// ── Sheet Modal ───────────────────────────────────────────────
function openSheetModal(title, desc, callback) {
  document.getElementById('sheetModalTitle').textContent = title;
  document.getElementById('sheetModalDesc').innerHTML = desc;
  document.getElementById('sheetIdInput').value = '';
  sheetModalCallback = callback;
  document.getElementById('sheetModal').classList.add('open');
}

// ── Sheets API ────────────────────────────────────────────────
async function sheetsGet(sheetId, range) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`Sheets API error ${res.status}: ${await res.text()}`);
  return res.json();
}

async function sheetsUpdate(sheetId, range, values) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ range, majorDimension: 'ROWS', values })
  });
  if (!res.ok) throw new Error(`Sheets update error ${res.status}: ${await res.text()}`);
  return res.json();
}

async function sheetsClear(sheetId, range) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}:clear`;
  const res = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`Sheets clear error ${res.status}`);
}

async function createSheetTab(sheetId) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests: [{ addSheet: { properties: { title: SHEET_NAME } } }] })
  });
  if (!res.ok) throw new Error(`Could not create sheet tab: ${res.status}`);
}

// ── Task parsing ──────────────────────────────────────────────
function parseTaskInput(raw) {
  return raw.split('\n')
    .map(line => line.trim()).filter(Boolean)
    .map(line => {
      const match = line.match(/^(.+?)\s*\[(\d+)min\]$/);
      return {
        name: match ? match[1].trim() : line,
        estimated: match ? parseInt(match[2]) : 0,
        startedAt: '', completedAt: '', actual: 0
      };
    });
}

// ── Merge Sort ────────────────────────────────────────────────
// We resolve comparisons by storing a single pending resolver,
// then calling it when a button is clicked. No cloning needed.
let pendingResolve = null;

function setCompareButtons(nameA, nameB) {
  document.getElementById('task1Text').textContent = nameA;
  document.getElementById('task2Text').textContent = nameB;
}

// The two compare buttons call this
function handleCompareChoice(choice) {
  if (pendingResolve) {
    const fn = pendingResolve;
    pendingResolve = null;
    fn(choice); // 'left' or 'right'
  }
}

function waitForChoice() {
  return new Promise(resolve => {
    pendingResolve = resolve;
  });
}

async function mergeSortInteractive(array) {
  if (array.length <= 1) return array;
  const mid = Math.floor(array.length / 2);
  const left = await mergeSortInteractive(array.slice(0, mid));
  const right = await mergeSortInteractive(array.slice(mid));
  return mergeInteractive(left, right);
}

async function mergeInteractive(left, right) {
  const result = [];
  let li = 0, ri = 0;
  while (li < left.length && ri < right.length) {
    setCompareButtons(left[li].name, right[ri].name);
    const choice = await waitForChoice();
    if (choice === 'left') {
      result.push(left[li++]);
    } else {
      result.push(right[ri++]);
    }
    completedComparisons++;
    updateProgress();
  }
  while (li < left.length) result.push(left[li++]);
  while (ri < right.length) result.push(right[ri++]);
  return result;
}

function updateProgress() {
  const pct = totalComparisons > 0 ? Math.min(100, Math.round((completedComparisons / totalComparisons) * 100)) : 0;
  document.getElementById('progressFill').style.width = pct + '%';
  document.getElementById('progressText').textContent = `${completedComparisons} / ${totalComparisons}`;
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

// ── Deadline Screen ───────────────────────────────────────────
function showDeadlineScreen() {
  if (currentTaskIndex >= sortedTasks.length) return;
  const task = sortedTasks[currentTaskIndex];
  document.getElementById('deadlineTaskName').textContent = task.name;
  document.getElementById('taskTimeInput').value = task.estimated || '';
  showScreen('deadlineScreen');
}

// ── Focus Screen ──────────────────────────────────────────────
function showFocusScreen() {
  if (timerInterval) clearInterval(timerInterval);
  const task = sortedTasks[currentTaskIndex];
  document.getElementById('focusTaskName').textContent = task.name;
  function updateTimer() {
    const now = Math.floor(Date.now() / 1000);
    const remaining = deadline - now;
    const abs = Math.abs(remaining);
    const m = Math.floor(abs / 60), s = abs % 60;
    const sign = remaining < 0 ? '-' : '';
    document.getElementById('timerDisplay').textContent = `${sign}${m}:${pad(s)}`;
    document.getElementById('timerDisplay').style.color = remaining >= 0 ? 'var(--green)' : 'var(--red)';
    document.getElementById('timerLabel').textContent = remaining >= 0 ? 'remaining' : 'over time';
  }
  updateTimer();
  timerInterval = setInterval(updateTimer, 1000);
  showScreen('focusScreen');
}

// ── Completion Screen ─────────────────────────────────────────
function showCompletionScreen() {
  const abs = Math.abs(spareTime);
  const h = Math.floor(abs / 3600), m = Math.floor((abs % 3600) / 60), s = abs % 60;
  const sign = spareTime >= 0 ? '+' : '-';
  const fmt = h > 0 ? `${sign}${h}:${pad(m)}:${pad(s)}` : `${sign}${m}:${pad(s)}`;
  document.getElementById('spareTimeDisplay').textContent = fmt;
  document.getElementById('spareTimeDisplay').style.color = spareTime >= 0 ? 'var(--green)' : 'var(--red)';
  document.getElementById('spareTimeLabel').textContent = spareTime >= 0 ? 'spare time' : 'over schedule';
  showScreen('completionScreen');
}

// ── EVENT LISTENERS ───────────────────────────────────────────

// Auth
document.getElementById('signInBtn').addEventListener('click', signIn);
document.getElementById('signOutBtn').addEventListener('click', signOut);

// Sheet modal
document.getElementById('sheetModalCancel').addEventListener('click', () => {
  document.getElementById('sheetModal').classList.remove('open');
});
document.getElementById('sheetModalConfirm').addEventListener('click', () => {
  const id = document.getElementById('sheetIdInput').value.trim();
  if (!id) { alert('Please enter a Sheet ID.'); return; }
  document.getElementById('sheetModal').classList.remove('open');
  if (sheetModalCallback) sheetModalCallback(id);
});

// Input screen — Sort
document.getElementById('startSortBtn').addEventListener('click', () => {
  const raw = document.getElementById('tasksInput').value.trim();
  if (!raw) { alert('Please enter at least one task.'); return; }
  const parsed = parseTaskInput(raw);
  if (parsed.length === 0) { alert('No valid tasks found.'); return; }
  sortedTasks = parsed;
  if (parsed.length === 1) {
    showSortedScreen();
    return;
  }
  totalComparisons = Math.ceil(parsed.length * Math.log2(parsed.length));
  completedComparisons = 0;
  updateProgress();
  showScreen('compareScreen');
  mergeSortInteractive([...parsed]).then(sorted => {
    sortedTasks = sorted;
    showSortedScreen();
  });
});

// Input screen — Import
document.getElementById('importSheetBtn').addEventListener('click', () => {
  if (!accessToken) { alert('Please sign in with Google first.'); return; }
  openSheetModal(
    'Import from Sheet',
    'Paste your Sheet ID. Reads from a tab named <strong>NextTask</strong>.',
    async (sheetId) => {
      setStatus('Importing…');
      try {
        const data = await sheetsGet(sheetId, `${SHEET_NAME}!A:E`);
        const rows = (data.values || []).slice(1);
        if (!rows.length) { setStatus('Sheet appears empty.', 'var(--red)'); return; }
        document.getElementById('tasksInput').value = rows
          .filter(r => r[0])
          .map(r => r[1] ? `${r[0]} [${r[1]}min]` : r[0])
          .join('\n');
        setStatus(`Imported ${rows.length} tasks.`, 'var(--green)');
      } catch (e) { setStatus('Import failed: ' + e.message, 'var(--red)'); }
    }
  );
});

// Compare screen buttons
document.getElementById('task1Btn').addEventListener('click', () => handleCompareChoice('left'));
document.getElementById('task2Btn').addEventListener('click', () => handleCompareChoice('right'));

// Sorted screen
document.getElementById('getToWorkBtn').addEventListener('click', () => {
  if (deadline > 0 && currentTaskIndex < sortedTasks.length) {
    showFocusScreen();
  } else {
    showDeadlineScreen();
  }
});
document.getElementById('addTaskBtn').addEventListener('click', () => {
  screenBeforeAdd = 'sortedScreen';
  document.getElementById('newTaskInput').value = '';
  showScreen('addTaskScreen');
});
document.getElementById('exportSheetBtn').addEventListener('click', () => {
  if (!accessToken) { alert('Please sign in with Google first.'); return; }
  openSheetModal(
    'Export to Sheet',
    'Paste your Sheet ID. Writes to a tab named <strong>NextTask</strong> (replaces existing data).',
    async (sheetId) => {
      setStatus('Exporting…');
      try {
        try { await sheetsClear(sheetId, `${SHEET_NAME}!A:Z`); } catch (_) { await createSheetTab(sheetId); }
        const header = ['Task', 'Estimated (min)', 'Started At', 'Completed At', 'Actual (min)'];
        const rows = sortedTasks.map(t => [t.name, t.estimated || '', t.startedAt || '', t.completedAt || '', t.actual || '']);
        await sheetsUpdate(sheetId, `${SHEET_NAME}!A1`, [header, ...rows]);
        setStatus('Exported!', 'var(--green)');
      } catch (e) { setStatus('Export failed: ' + e.message, 'var(--red)'); }
    }
  );
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

// Deadline screen
document.getElementById('startTaskBtn').addEventListener('click', () => {
  const mins = parseInt(document.getElementById('taskTimeInput').value, 10);
  if (!mins || mins < 1 || mins > 180) { alert('Please enter a time between 1 and 180 minutes.'); return; }
  const task = sortedTasks[currentTaskIndex];
  task.estimated = mins;
  deadline = Math.floor(Date.now() / 1000) + mins * 60;
  taskStartTime = Math.floor(Date.now() / 1000);
  task.startedAt = formatDateTime(new Date());
  showFocusScreen();
});

// Focus screen
document.getElementById('doneNextBtn').addEventListener('click', () => {
  clearInterval(timerInterval);
  const now = Math.floor(Date.now() / 1000);
  spareTime += deadline - now;
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
document.getElementById('addTaskFocusBtn').addEventListener('click', () => {
  clearInterval(timerInterval);
  screenBeforeAdd = 'focusScreen';
  document.getElementById('newTaskInput').value = '';
  showScreen('addTaskScreen');
});

// Add task screen
document.getElementById('saveNewTaskBtn').addEventListener('click', async () => {
  const name = document.getElementById('newTaskInput').value.trim();
  if (!name) { alert('Please enter a task name.'); return; }
  const newTask = { name, estimated: 0, startedAt: '', completedAt: '', actual: 0 };
  const allTasks = [...sortedTasks, newTask];
  totalComparisons = Math.ceil(allTasks.length * Math.log2(allTasks.length));
  completedComparisons = 0;
  updateProgress();
  showScreen('compareScreen');
  const sorted = await mergeSortInteractive(allTasks);
  sortedTasks = sorted;
  // After re-sort, go back to where we came from
  if (screenBeforeAdd === 'focusScreen') {
    // Find the current task again (index may have shifted)
    const currentName = sortedTasks[currentTaskIndex] ? sortedTasks[currentTaskIndex].name : null;
    showSortedScreen();
  } else {
    showSortedScreen();
  }
});
document.getElementById('cancelAddTaskBtn').addEventListener('click', () => {
  if (screenBeforeAdd === 'focusScreen') {
    showFocusScreen();
  } else {
    showScreen('sortedScreen');
  }
});

// Completion screen
document.getElementById('startOverBtn').addEventListener('click', () => {
  sortedTasks = [];
  currentTaskIndex = 0;
  deadline = 0;
  spareTime = 0;
  taskStartTime = 0;
  document.getElementById('tasksInput').value = '';
  setStatus('');
  showScreen('inputScreen');
});
