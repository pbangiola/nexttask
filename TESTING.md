# Commit 3 testing

This commit restores the sequential planning timer on top of commits 1 and 2.

## Expected behavior

1. Start a timed session and sort a list.
2. Choose **Yes** when asked whether to set timings.
3. The estimate screen should show:
   - `Current Task: ...`
   - `Time to work with:`
   - a large green live timer
4. The timer should be calculated from:

   `hardStopAtMs - Date.now() - sum(incomplete task estimates)`

5. Wait several seconds. The displayed time should tick down.
6. Save an estimate. The timer on the next task should immediately drop by that estimate.
7. The input maximum should never exceed the whole minutes still available.
8. When no allocatable time remains, planning should return to the task-list dashboard.
9. Reload while on a timing-entry screen. The app should restore the planning screen and continue from the current hard stop rather than resetting the budget.

## Regression checks

- Sorting still appears as the completed `Sort Tasks` task.
- The sorting timer still counts down and turns red when overdue.
- The hard stop still ends the session without completing the active task.
- Focus-task timing still works normally.

## Syntax validation

`node --check script.js` passed before packaging.
