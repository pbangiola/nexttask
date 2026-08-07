# Commit 6 testing

## NextTask-format text

Upload:

```text
Uncompleted Tasks
—————————————
1. Write report — 15 min
2. Call Sam — blocked

Completed Tasks
—————————————
1. Wash dishes ✓
```

Expected imported tasks:

1. Write report
2. Call Sam

`Uncompleted Tasks`, separator lines, and `Wash dishes` must not become tasks.

## Checkbox format

Upload:

```text
Remaining Tasks:
[ ] Buy milk
☐ Send email
```

Expected:

- Buy milk
- Send email

## Plain-text fallback

Upload:

```text
Draft proposal
Review budget
```

Expected: both lines import normally.

## CSV regression

Upload a CSV exported by the current app. Estimates, actual time, completion status,
and task IDs should still parse as before.
