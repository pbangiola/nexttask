# Testing commit 4

## Syntax checks

```bash
node --check server.js
node --check user-store.js
```

## Functional test

1. Ensure the backend already has an older open list:
   - Old A
   - Old B
2. Start a new session with:
   - New 1
   - New 2
3. End the session without completing either new task.
4. Resume the saved list.
5. Expected order:
   - New 1
   - New 2
   - Old A
   - Old B

## Repeat-save test

1. Save the same current session several times.
2. Resume the task list.
3. Confirm tasks are not duplicated and positions remain compact and ordered.

## Completion test

1. Complete `New 1` and save again.
2. Resume.
3. Confirm `New 1` is absent from the open queue and the order begins with `New 2`.
