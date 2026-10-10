# Task Graph Rebuild — Issue Review

Reviewed the 21 open repository issues on 2026-10-10. This commit hardens the new task-graph API; it does **not** claim to finish the entire backlog.

## Changes in this commit
- Expose actionable open tasks from the canonical task table for Work integration (#68).
- Reject queue items that are projects, non-actionable, completed or cancelled (#68).
- Prevent cross-user work-session ID takeover through upsert (#42, #59).
- Reject work intervals for non-actionable/closed tasks and ended work sessions (#69).
- Clamp client-provided stop timestamps to server time to avoid future-duration inflation (#69).

## Remaining engineering work
- Wire the actual Work sorting and Focus screens to new APIs (#68, #69).
- Implement safe legacy migration and rollback tests (#70).
- End-to-end tests for blocker queue (#58), nested rollups (#52), completion (#50), duplicate review (#57), auth (#59), mobile suspension (#30).
- Evaluate metrics (#60), progress indicators (#35), and UI improvements (#43).
- Evaluate encryption requirements (#42) before choosing at-rest vs end-to-end encryption.

## User decisions/actions
- Decide whether #61–63 personal tasks belong in this repository.
- Choose whether to preserve the anonymous MVP and signed-in Pro as separate experiences (#48, #49).
- Confirm encryption threat model and any external service configuration for beta (#42, #46, #59).
- Perform manual mobile/browser/SSO verification before any production deployment.

Do not close issues solely on the basis of code presence. No destructive migration or production deployment is included.
