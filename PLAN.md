# Commit 3 plan

## Scope

Restore the sequential estimate-entry screen as a live task-like planning timer.

## Implementation

- Replace the static remaining-budget text with a green, one-second countdown.
- Label it `Time to work with:`.
- Derive it from the canonical hard-stop timestamp, current time, and estimates already assigned.
- Recalculate the permitted maximum estimate continuously and again at submission time.
- Prevent an estimate from exceeding the live remaining budget.
- Exit planning when the allocation budget reaches zero.
- Restore the timing-entry and timing-gateway views correctly after reload.

## Deliberately deferred

- The separate `Do you have a deadline?` step.
- Minimum 10-minute deadline validation.
- Backend queue ordering.
- Duplicate prompting.
- Import/export cleanup.
- Add-task and blocker UX changes.
