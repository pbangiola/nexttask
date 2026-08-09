# NextTask Timing and Task-State Model

## Core conventions

1. All internal timestamps and durations use milliseconds.
2. Unix timestamps come from `Date.now()`.
3. User-facing minutes, seconds, and hours are derived only for display, input, and export.
4. The browser is authoritative during an active work session.
5. Local changes happen immediately. Server writes happen asynchronously and do not block the user.
6. The backend is read synchronously only when the user chooses **Resume Existing List**.

## Task object

Each task should have a stable object shape:

```js
{
    id: crypto.randomUUID(),
    name: 'Grade papers',
    estimatedTimeMs: 20 * 60 * 1000,
    actualTimeMs: 0,
    completed: false,
    created: Date.now(),
    started: null,
    completedTime: null,
    lastChanged: null
}
```

### Field meanings

- `id`: Stable task identity. Task names are not identifiers.
- `name`: User-facing task name.
- `estimatedTimeMs`: The user's estimate, stored in milliseconds.
- `actualTimeMs`: Accumulated active work time, stored in milliseconds.
- `completed`: Explicit Boolean completion status.
- `created`: Unix-millisecond timestamp when the task was created.
- `started`: Unix-millisecond timestamp when the task was first started.
- `completedTime`: Unix-millisecond timestamp when the task was completed.
- `lastChanged`: Unix-millisecond checkpoint for an actively running task. `null` means the task is paused.

## Selecting the active task

The active task is the first task in `sortedTasks` whose `completed` field is `false`.

```js
function getCurrentTaskIndex() {
    return sortedTasks.findIndex(task => !task.completed);
}

function getCurrentTask() {
    return sortedTasks.find(task => !task.completed) || null;
}
```

`currentTaskIndex` may remain temporarily for compatibility, but it must not be the source of truth for completion.

This model supports out-of-order completion: a later task may be marked complete while an earlier task remains incomplete.

## Starting or resuming a task

Starting the focus screen begins an active timing interval. It does not immediately add time.

```js
function beginTaskTiming(task) {
    const now = Date.now();

    if (task.started === null) {
        task.started = now;
    }

    task.lastChanged = now;
}
```

When resuming a deliberately paused task, `lastChanged` is reset to the current time so the paused interval is not counted.

## Updating the timer

The timer must use the real difference between Unix-millisecond timestamps. It must not assume that `setInterval()` ran exactly once per second.

```js
function updateTimer() {
    const now = Date.now();
    const elapsedSinceLastUpdateMs = now - nextTask.lastChanged;

    nextTask.actualTimeMs += elapsedSinceLastUpdateMs;
    nextTask.lastChanged = now;

    const timeRemainingMs =
        nextTask.estimatedTimeMs - nextTask.actualTimeMs;

    renderTimer(timeRemainingMs);
}
```

The order is important: calculate the elapsed interval before replacing `lastChanged`.

This design intentionally uses browser behavior:

- `setInterval()` may be delayed or throttled in a background tab.
- `Date.now()` continues advancing.
- When the callback runs again, `Date.now() - lastChanged` captures the entire interval.

Therefore a delayed callback, background tab, sleeping computer, or temporarily suspended browser does not lose elapsed time.

## Timer display

Reaching zero does not complete a task, stop the interval, show an alert, or advance the queue. The timer is a visual pacing tool.

```js
function renderTimer(timeRemainingMs) {
    const overdue = timeRemainingMs < 0;
    const absoluteSeconds = Math.floor(Math.abs(timeRemainingMs) / 1000);

    const hours = Math.floor(absoluteSeconds / 3600);
    const minutes = Math.floor((absoluteSeconds % 3600) / 60);
    const seconds = absoluteSeconds % 60;

    const formattedTime = hours > 0
        ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
        : `${minutes}:${String(seconds).padStart(2, '0')}`;

    timerDisplay.style.color = overdue ? 'red' : 'green';
    timerDisplay.textContent = overdue
        ? `${formattedTime} overdue`
        : `${formattedTime} remaining`;
}
```

The displayed format is `[hh:]mm:ss overdue` after the estimate is exceeded.

## Browser suspension and refresh

An active task has a non-null `lastChanged` timestamp. When a suspended tab resumes, the next update includes the whole elapsed interval.

When an active task is restored after refresh:

1. Find the first incomplete task.
2. Confirm that `lastChanged` is non-null.
3. Add the elapsed interval since `lastChanged`.
4. Set `lastChanged` to the current timestamp.
5. Reopen the focus screen.
6. Display remaining or overdue time from the task's estimate and accumulated actual time.

An incomplete overdue task remains on the focus screen after refresh.

## Add New Task

Opening **Add New Task** does not pause the active task.

The visual interval may stop while another screen is shown, but `lastChanged` remains unchanged. When the focus screen returns, the timestamp difference includes the time spent adding the task.

## Stop Working

**Stop Working** is a separate workflow decision and should not mark the active task complete.

At minimum, it must:

1. Save elapsed time through the current timestamp.
2. Set `lastChanged` to `null` so additional time does not accumulate.
3. Leave `completed` as `false`.
4. Preserve the active task in the uncompleted list.
5. Allow the out-of-order completion checklist to mark other tasks complete explicitly.

```js
function pauseTaskTiming(task) {
    if (task.lastChanged === null) return;

    const now = Date.now();
    task.actualTimeMs += now - task.lastChanged;
    task.lastChanged = null;
}
```

## Completing a task

Only an explicit completion action marks a task complete.

```js
function completeTask(task) {
    pauseTaskTiming(task);
    task.completed = true;
    task.completedTime = Date.now();
}
```

The **Done, Next!** button should be disabled immediately after the first click to prevent duplicate completion handling.

## Capacity calculations

Capacity is derived, not stored.

Every incomplete task without an estimate counts as ten minutes. Completed tasks do not count against the remaining work window.

```js
function getTotalAllocatedTimeMs() {
    return sortedTasks
        .filter(task => !task.completed)
        .reduce(
            (sum, task) => sum + (
                task.estimatedTimeMs > 0
                    ? task.estimatedTimeMs
                    : 10 * 60 * 1000
            ),
            0
        );
}
```

The backend can calculate equivalent totals with `SUM(estimated_time_ms)`.

## Persistence model

The browser sends the full task list to the backend without waiting for the server response before continuing the interface.

Completed tasks remain in storage. The **Resume Existing List** endpoint returns only incomplete tasks. Completed-work reports can be added later.

The separate `completed_tasks` table is redundant and should be removed. Task completion is represented by the task object's `completed` field and completion timestamp. Repeated writes of the same stable task ID should upsert the same row rather than create duplicate completion records.

The session `state_json` field should eventually be removed. Session-level storage may retain only genuine session data, while task data belongs in the tasks table.

## Backend ordering

SQL tables do not have guaranteed inherent order. The backend must persist an explicit integer position for each task, even though the frontend array remains the immediate source of queue order.

## Import and export

Imports should accept:

- Newline-separated task names.
- A single comma-separated line such as `Task 1, Task 2, Task 3`.
- Plain-text files.
- One-column CSV files.
- Recognizable task columns from other tools.
- NextTask's structured CSV export.

When an input contains multiple non-empty lines, each line is a task. When it contains one non-empty line, commas may separate tasks. Properly quoted CSV follows CSV parsing rules.

Papa Parse should be used when available. If it fails to load or throws, importing falls back quietly to the simple text parser. The user sees an error only when no usable tasks can be recovered.

Structured CSV export order:

```text
Task Name,Estimated Time (Min),Actual Time (Min),Completed,Task ID
```

Task IDs remain in the rightmost column. Imported IDs are preserved exactly. Structured imports containing task IDs are treated as already sorted and go directly to the task-list display rather than interactive sorting.

User-supplied task names must be inserted with `textContent` or explicitly created DOM nodes rather than interpreted through `innerHTML`.
