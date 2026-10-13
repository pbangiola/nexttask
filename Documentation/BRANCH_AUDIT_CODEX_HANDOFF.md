# NextTask branch audit and Codex debugging handoff
Audit date: 2026-10-13. Repository: pbangiola/nexttask.

## Start here
Create a debugging branch from current main. Read this document before attempting wholesale branch merges. Incorporate task-graph-rebuild first after repairing its startup and data-safety blockers; integrate Ssoplusmvp guest behavior second. Keep Eisenhower as an optional separate view pending Paul's decision. Preserve existing branch refs and task data. Use disposable databases for tests.

## Audited branch heads
These counts are historical, against main 98e048204d8c248c4f0ccb4dc1ff3424eb06421c, BEFORE this consolidation. They count commits, not unique features.

| Branch | Audited SHA | Commits unique to main / branch | Disposition |
|---|---|---:|---|
| main | 98e048204d8c248c4f0ccb4dc1ff3424eb06421c | — | Production foundation; received only compatible planner changes |
| sso | 32e325f66530500780078bdfd68d3da58d25f55a | 4 / 13 | Shared foundation; selected planner changes extracted, remaining timing and completion changes need review |
| Ssoplusmvp | 9890d4ad783851aeef1544113605ec822d66b388 | 4 / 26 | Contains all sso commits plus guest entry, mixed timing, decomposition, audio; integrate selectively after graph repair |
| task-graph-rebuild | a590b42614a633169f4cdf38cf37bb2fb186598c | 4 / 66 | Contains all sso commits plus durable queues, intervals, ownership and recovery; currently fails syntax check |
| Eisenhower | 746ee9df7dc6edb3b3c664f8e0469a834a767109 | 4 / 15 | Contains all sso commits plus two planner prototype commits; replaces index and script, unsuitable as whole-branch merge |
| MVP | 4df391a15e63b4c50f141d71f765c3371646645a | 118 / 11 | Standalone legacy frontend; deletes backend, modular frontend, package and deployment files; retain reference |

No original branch is fully redundant by ancestry. No original branches were deleted, reset, or force-pushed.

## Duplicated work and consolidation
- The sso foundation is shared by Ssoplusmvp, Eisenhower and task-graph-rebuild. Merging it repeatedly is unnecessary.
- Project estimate preservation commit 32e325f has the same patch as main's b38ac83. All five modular branch planners contain that implementation.
- Audio files on main, MVP and Ssoplusmvp are byte-identical (SHA-256 a3179e6a052ffec495102cef0034dca224d35ccf270592a4040fab5f33f58485). Their different commit SHAs do not represent different audio features.
- main loaded both the canonical planner and a legacy MutationObserver bulk handler. The latter captures partsContinue clicks and overrides the canonical handler.
- Consolidation takes the sso loader change from 88188dd (stop loading project-bulk-create.js), the root-node fallback from 4bafd61, and fresh asset URLs. It preserves main's canonical project estimates and audio.
- The bulk-handler file remains for reference but is no longer loaded. Its a97fe4e estimate changes are not independently merged because the canonical planner already preserves estimates.
- Uploaded package.json, server.js, database.js, script.js and index.html match none of the six branch heads at their plausible root/backend paths. The uploaded backend lacks Clerk authentication. Treat the attachments as older reference material, not authoritative replacements.

## Validation actually performed
- Node syntax checks on every tracked JavaScript file at each audited head: main 20 passed; sso 19 passed; MVP 2 passed; Ssoplusmvp 21 passed; Eisenhower 20 passed; graph 26 passed and backend/user-store.js failed.
- A local Node VM harness exercised the consolidated planner against a root-project response missing from the full-tree response: project card retained its 2-minute root estimate and 0-step count.
- Consolidated loader assertions verified one active project-entry handler, updated auth/planner URLs and retained audio script.
- Graph timing bridge tests: 2 passed (rapid start/stop serialization and restored interval reuse).
- Full graph npm test: 2 passed, 3 failed in this environment due to missing better-sqlite3 native bindings. npm rebuild failed extracting Node 24 headers with an fchown EINVAL error. These are environment failures, not proof of SQLite logic failures.
- No authenticated browser, mobile, production database migration, or live deployment verification was performed. Code presence and passing syntax do not establish end-to-end correctness.

## Prioritized development sequence

### 1. P0 — Graph startup blocker (confirmed by execution)
File: task-graph-rebuild backend/user-store.js, importOpenTasksIntoSession, approximately line 93.
A literal backslash-n occurs inside a // comment. It comments out the return and closing method delimiter; node --check reports Unexpected token at getRootNodes.
Replace the escaped text with a real line break and restore valid method syntax. Keep import non-destructive: do not move canonical nodes to legacy session IDs.
Acceptance: syntax checks pass for every JS file; server starts; integrity, store and restart tests pass with native SQLite installed on a supported Node runtime. Do not mask or skip failing integration tests.

### 2. P0 — Static serving and ownership (inspection findings)
Graph backend/server.js serves the repository root through express.static before authentication. This can expose backend source and the default backend/task_sorter.db if present. Main also serves the backend directory directly, so examine both.
Serve only intended public frontend assets and index; never mount a directory containing SQLite or backend source as a public static root.
Acceptance: requests for backend source, SQLite, WAL/SHM files and internal data return no file bytes; index and required frontend assets load; public health/config work; private APIs require valid auth.
Preserve graph ownership guards from e89faea and later snapshot fixes. Test foreign-user task IDs through legacy PUT, attach, queue, intervals, planner CRUD and resume. Review claimUnownedTasks, which claims all NULL-owner tasks, before any migration. Decide legacy attribution explicitly instead of bulk-assigning anonymous data to whichever user signs in.

### 3. P1 — Complete durable-work integration (inspection finding)
Graph startNodes and sorted existing-work selections call persistSelectedWork; core.sortPreparedTaskList/beginWork for newly entered tasks do not create a durable work session. TaskGraphTiming.start silently returns when activeWorkSessionId is missing, or may use a stale recovered session.
Route every authenticated work-entry path through a single queue/session creation step after task persistence. Keep project sibling position distinct from work queue rank.
Acceptance: new lists and existing nested projects both have durable session IDs, ordered queue items and interval records; browser-storage deletion and server restart recover them; no graph renaming, flattening or session relocation.

### 4. P1 — Stop/recovery and timing reconciliation (inspection finding)
Graph handleHardStop saves session-ended without ending the durable session. Local timestamps remain the displayed clock, while durable intervals are best effort. Initialization prefers cached tasks with matching IDs over server fields, so stale status/elapsed state can survive recovery.
Define and implement explicit durable session ending for hard stop, Stop Working and completion; reconcile interval elapsed time with local clocks without double counting. Test transient start/stop failure, mobile suspension, reload and cross-device recovery.
Acceptance: ended work does not resurrect; no orphan running intervals; pause/resume and rapid Done/Next preserve interval ordering; elapsed time agrees with the chosen source of truth. Keep delayed-start fixes already present in graph.

### 5. P1 — Timing parser, duplicates and decomposition (inspection finding)
sso/graph startSorting falls back to plain-name parsing for mixed timed/untimed input, dropping valid estimates and splitting commas into task names. Ssoplusmvp improves multiline mixed input, but its single-line fallback still splits mixed comma records indiscriminately.
Port parser improvements selectively into repaired graph/current main. Use entry identity to keep estimates attached through duplicate rename/removal. Do not reactivate project-bulk-create.js: its estimates are matched by array index after duplicate resolution.
Examples: "Email Sam, 10m\nBuy milk", fully timed duplicates with different estimates, comma-separated untimed tasks, imported completed tasks, and a single line mixing timed/untimed content.
Acceptance: each real task appears once with the correct estimate; duration tokens do not become tasks; only untimed tasks prompt for an estimate.
Ssoplusmvp decomposition replaces a parent task with flat subtasks and saves timing-entry even while decomposition is displayed. Decide whether this is intended list splitting or true parent/child project creation; add refresh recovery for the chosen behavior.

### 6. P1 — Guest/auth integration (inspection finding)
Ssoplusmvp loads frontend/entry.js instead of graph/auth.js. Its loader does not load graph helpers, hardcodes production backend even on localhost, lacks graph's token-subject/account-switch guards, and would replace graph recovery initialization if merged wholesale.
Build one bootstrap that loads shared UI once, keeps guest data local, routes localhost requests locally, and loads graph features for authenticated users. Preserve active Clerk-session ownership validation.
Acceptance: guest task entry works without sending task data to server; guest and each account have isolated state; sign-in/out and account switch cannot expose another user's data; authenticated recovery still works.
Review planner/project UI localStorage keys, which are global rather than per user.
Guest startup currently waits for config/Clerk detection before loading core; test offline/slow-network usability. Do not silently upload guest tasks at sign-in.

### 7. P2 — Optional Eisenhower integration (product decision required)
Eisenhower replaces index.html and script.js with a standalone importance/urgency prototype, while retaining unused modular code. It is not an additive patch to the current signed-in application.
Ask whether Paul wants a separate optional view or a replacement workflow. If optional, implement against canonical task IDs and persisted due dates, and preserve Work/Focus/Plan navigation. Do not choose this silently.

### 8. Final merge and cleanup
After graph fixes and tests pass, integrate on a branch based on current main, resolve shared SSO changes once, preserve audio, and run authenticated browser/mobile checks. Then integrate guest changes with the same acceptance gates. Verify deployment triggers and backend/frontend compatibility before merging changes that alter API contracts.
Do not squash prototype branches into main just to remove branch count. Archive/delete only after their unique work is accounted for and branch deletion is explicitly approved.

## Product decisions to surface
- Guest and signed-in flows in one application versus separate products.
- Whether an empty project remains pending (main and canonical graph intention) or counts as completed (some sso legacy paths). Keep empty projects until this is settled.
- Whether long-task decomposition creates real hierarchy or just replaces a list item.
- Whether durable intervals or local clocks are authoritative.
- Eisenhower as optional view versus replacement.
- Legacy anonymous task ownership and guest-to-account import behavior.
