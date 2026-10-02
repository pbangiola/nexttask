// Eisenhower Planner rough prototype.
// Importance is ordinal and user-supplied through pairwise merge sort.
// Urgency is derived: latestStartMs = deadlineMs - durationMs.

let tasks = [];
let comparisonCount = 0;
let expectedComparisons = 0;
let matrixInterval = null;

const $ = id => document.getElementById(id);

function show(id) {
  ['entryScreen','compareScreen','timingScreen','resultScreen'].forEach(x => $(x).classList.add('hidden'));
  $(id).classList.remove('hidden');
}

function estimatedComparisons(n) {
  return n <= 1 ? 0 : Math.ceil(n * Math.log2(n));
}

$('startImportanceBtn').addEventListener('click', async () => {
  const names = $('taskInput').value.split('\n').map(s => s.trim()).filter(Boolean);
  const unique = [...new Set(names)];
  if (!unique.length) return alert('Enter at least one task.');

  tasks = unique.map((name, i) => ({
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + i),
    name,
    importanceRank: null,
    deadlineMs: null,
    estimatedDurationMs: null
  }));

  comparisonCount = 0;
  expectedComparisons = estimatedComparisons(tasks.length);

  if (tasks.length > 1) {
    show('compareScreen');
    tasks = await mergeSortInteractive(tasks);
  }

  tasks.forEach((task, index) => task.importanceRank = index + 1);
  renderTimingInputs();
});

async function mergeSortInteractive(items) {
  if (items.length <= 1) return items;
  const middle = Math.floor(items.length / 2);
  const left = await mergeSortInteractive(items.slice(0, middle));
  const right = await mergeSortInteractive(items.slice(middle));
  return mergeInteractive(left, right);
}

function mergeInteractive(left, right) {
  return new Promise(resolve => {
    const result = [];

    function next() {
      if (!left.length || !right.length) {
        resolve(result.concat(left, right));
        return;
      }

      comparisonCount++;
      $('compareProgress').textContent =
        'Comparison ' + comparisonCount + ' of about ' + expectedComparisons;
      $('taskA').textContent = left[0].name;
      $('taskB').textContent = right[0].name;

      $('taskA').onclick = () => { result.push(left.shift()); next(); };
      $('taskB').onclick = () => { result.push(right.shift()); next(); };
    }
    next();
  });
}

function renderTimingInputs() {
  show('timingScreen');
  const rows = $('timingRows');
  rows.innerHTML = '';

  tasks.forEach(task => {
    const row = document.createElement('div');
    row.className = 'task-row';
    row.innerHTML =
      '<div class="task-name">#' + task.importanceRank + ' ' + escapeHtml(task.name) + '</div>' +
      '<label>Deadline<input type="datetime-local" data-deadline="' + task.id + '"></label>' +
      '<label>Duration (min)<input type="number" min="1" data-duration="' + task.id + '" placeholder="30"></label>';
    rows.appendChild(row);
  });
}

$('buildMatrixBtn').addEventListener('click', () => {
  for (const task of tasks) {
    const deadlineInput = document.querySelector('[data-deadline="' + task.id + '"]');
    const durationInput = document.querySelector('[data-duration="' + task.id + '"]');
    const deadline = new Date(deadlineInput.value).getTime();
    const durationMinutes = Number(durationInput.value);

    if (!deadlineInput.value || !Number.isFinite(deadline) || durationMinutes <= 0) {
      return alert('Please add a deadline and positive duration for every task.');
    }
    task.deadlineMs = deadline;
    task.estimatedDurationMs = durationMinutes * 60 * 1000;
  }

  show('resultScreen');
  renderMatrix();
  clearInterval(matrixInterval);
  matrixInterval = setInterval(renderMatrix, 60000);
});

function latestStartMs(task) {
  return task.deadlineMs - task.estimatedDurationMs;
}

function urgencyMs(task) {
  return latestStartMs(task) - Date.now();
}

function renderMatrix() {
  const matrix = $('matrix');
  matrix.querySelectorAll('.point').forEach(p => p.remove());

  const values = tasks.map(urgencyMs);
  const maxAbs = Math.max(...values.map(Math.abs), 60 * 60 * 1000);

  tasks.forEach(task => {
    // X: least important at left, most important at right.
    const x = tasks.length === 1 ? 75 :
      10 + ((tasks.length - task.importanceRank) / (tasks.length - 1)) * 80;

    // Y: urgent/late toward top; ample time toward bottom.
    // Zero latest-start slack is the horizontal center line.
    const normalized = Math.max(-1, Math.min(1, urgencyMs(task) / maxAbs));
    const y = 50 + normalized * 40;

    const point = document.createElement('div');
    point.className = 'point' + (urgencyMs(task) <= 0 ? ' overdue' : '');
    point.style.left = x + '%';
    point.style.top = y + '%';
    point.title =
      'Importance #' + task.importanceRank +
      '\nLatest start: ' + new Date(latestStartMs(task)).toLocaleString() +
      '\nSlack: ' + formatDuration(urgencyMs(task));
    point.textContent = task.name;
    matrix.appendChild(point);
  });

  const ranked = $('rankedList');
  ranked.innerHTML = '';
  tasks.forEach(task => {
    const li = document.createElement('li');
    li.textContent = task.name + ' — latest start ' +
      new Date(latestStartMs(task)).toLocaleString() +
      ' (' + formatDuration(urgencyMs(task)) + ')';
    ranked.appendChild(li);
  });
}

function formatDuration(ms) {
  const late = ms < 0;
  const mins = Math.round(Math.abs(ms) / 60000);
  const days = Math.floor(mins / 1440);
  const hours = Math.floor((mins % 1440) / 60);
  const minutes = mins % 60;
  const parts = [];
  if (days) parts.push(days + 'd');
  if (hours) parts.push(hours + 'h');
  if (minutes || !parts.length) parts.push(minutes + 'm');
  return (late ? 'start overdue by ' : 'start in ') + parts.join(' ');
}

function escapeHtml(value) {
  const div = document.createElement('div');
  div.textContent = value;
  return div.innerHTML;
}

$('startOverBtn').addEventListener('click', () => {
  clearInterval(matrixInterval);
  tasks = [];
  $('taskInput').value = '';
  show('entryScreen');
});