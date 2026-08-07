# Commit 4 plan: Prepend unfinished backend tasks

## Problem

When a session saves its unfinished tasks, those tasks can appear behind older tasks in the user's backend task list because `position` values are session-relative and collide across sessions.

## Fix

- Treat the unfinished task IDs sent by the current session as the front of the user's open-task queue.
- Preserve their exact current order.
- Append all older open tasks after them, preserving their previous order.
- Deduplicate by stable task ID.
- Compact positions to `1..n` on each sync so repeated saves do not cause position inflation.
- Leave completed and cancelled tasks out of the open queue.

## Files changed

- `server.js`
- `user-store.js`

No frontend files change in this commit.
