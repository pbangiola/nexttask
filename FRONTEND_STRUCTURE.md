# Task Sorter frontend structure

This is a first-pass structural refactor. The feature files intentionally remain classic browser scripts sharing the same global scope, which preserves the original behavior while making the code easier to navigate.

- `js/state.js` — configuration and shared application state
- `js/utils/helpers.js` — formatting and timing helpers
- `js/session/session.js` — session persistence, queue API, and view restoration
- `js/ui/start-over.js` — Start Over controls and modal
- `js/tasks/task-input.js` — task entry, capacity warning, and CSV import
- `js/tasks/task-timing.js` — upfront and sequential time estimates
- `js/tasks/add-task.js` — adding and positioning a task during work
- `js/sorting/merge-sort.js` — interactive merge sort
- `js/workflow/dashboard.js` — sorted task dashboard
- `js/workflow/deadline.js` — deadline setup
- `js/workflow/focus.js` — focus screen and timer
- `js/workflow/stop-working.js` — stopping, checklist, and exports
- `js/workflow/completion.js` — final report
- `js/app.js` — event listeners and initialization

`script.js` is now a harmless compatibility stub. `script.original.js` contains the pre-refactor source.
