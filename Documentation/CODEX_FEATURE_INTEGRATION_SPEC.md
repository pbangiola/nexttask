# Codex specification: consolidate NextTask features into main

Date: 2026-10-13
Repository: https://github.com/pbangiola/nexttask
Baseline main before this document: 32e7368edc16e0e804f7fc61ce03770c78ace392
Supporting audit: Documentation/BRANCH_AUDIT_CODEX_HANDOFF.md
Feature source: https://docs.google.com/spreadsheets/d/121ZmtFI-BeVkAZcvRqq9Fq1XQQIGP4D-_PcQDcVW8eU/edit
Source tabs: Sheet2 flags, Sheet1 feature names. Matching by row/category is an explicit assumption because Sheet2 omits names.

## Objective
Consolidate existing branch work into one application based on current main. First make task/session persistence reliable, then integrate guest usability, prerequisites and optional importance/urgency functionality. Preserve existing task IDs, project hierarchy, user ownership, estimates, audio and Work/Focus/Plan navigation.

This document specifies work; it does not claim the branches are working. Do not treat spreadsheet TRUE flags as verification.

## Execution instructions
1. Read this specification, the supporting audit, repository instructions and current code.
2. Fetch current refs. Recheck source branch SHAs and report material changes since the audit.
3. Work on a new branch from current main. Use the PR-sized sequence below; later work builds on accepted earlier work.
4. Reuse existing branch implementations selectively. Do not merge complete prototype trees or recreate features already in main.
5. Run targeted tests plus required integration checks. Record code inspection separately from actual execution.
6. Open reviewable PRs with problem, behavior, validation, limitations and source branch provenance. This specification authorizes implementation and draft PR preparation; it does not independently authorize merging/deployment or deleting branches.
7. Continue independent work when a product decision is pending. Do not silently choose a behavior that changes task meaning, scheduling or data ownership.

## Branch sources
| Branch | Audited head | Reuse | Do not copy wholesale |
|---|---|---|---|
| task-graph-rebuild | a590b42614a633169f4cdf38cf37bb2fb186598c | Canonical ownership guards, durable work sessions, queue ranks, intervals, recovery, tests | Broken user-store syntax, broad static mount, incomplete new-list/session and ending integration |
| Ssoplusmvp | 9890d4ad783851aeef1544113605ec822d66b388 | Guest entry, mixed timing parser, decomposition UI | Bootstrap that omits graph helpers/recovery and hardcodes production locally |
| sso | 32e325f66530500780078bdfd68d3da58d25f55a | Shared timing continuation and planner foundation where still needed | Already incorporated fixes; inconsistent empty-project completion behavior |
| Eisenhower | 746ee9df7dc6edb3b3c664f8e0469a834a767109 | Pairwise importance, deadline/duration input, latest-start calculation, matrix | Replacement index.html/script.js and separate ephemeral task store |
| MVP | 4df391a15e63b4c50f141d71f765c3371646645a | Reference for simple entry and metrics export | Backend/frontend/deployment deletions; old identity/persistence model |

Main already contains project estimate preservation and audio alerts. PR #72 stopped loading project-bulk-create.js and added the root-project fallback. Do not reactivate that overriding MutationObserver handler.

## Non-negotiable engineering invariants
- Canonical tasks/projects have stable IDs and user ownership. Work items reference them; work sessions are not task containers.
- Project sibling position and session queue rank are independent.
- Work selections and legacy snapshots cannot flatten, relocate, rename or transfer canonical nodes.
- Only eligible actionable tasks can start work. Projects are containers unless a later explicit product decision changes this.
- Snapshot and interval writes are ordered, awaited where needed, and recoverable. Preserve local usability during recoverable failures without misrepresenting server persistence.
- A deliberate account switch cannot reuse another account's local state or token.
- Local development never sends test task data to production.
- Migrations preserve data. Inspect existing one-time destructive fresh-start migration and markers; do not rerun resets or claim all anonymous rows for the next signed-in user.
- Preserve export/import and current audible deadline cues.
- Keep original source branches intact.

## PR 1 — Repair and integrate the durable graph foundation
Feature rows: 2, 4, 5, 8, 9, 10, 11, 14, 15, 20, 21, 34.
Primary sources: graph backend/task-graph-store.js, task-graph-routes.js, database.js, user-store.js; graph tests; existing main tree-integrity.js.

Tasks:
- Fix importOpenTasksIntoSession in graph user-store.js: a literal backslash-n inside a line comment comments out its return/closing delimiter. Keep canonical import read-only with respect to hierarchy/session ownership.
- Replace unsafe static mounts with an explicit public frontend surface. Neither backend source nor SQLite/WAL/SHM files may be served.
- Integrate owned durable sessions, ranked queue items and intervals while retaining main's public health/config behavior.
- Preserve ownership and graph protection changes from the source branch.
- Review compatibility of main tree-integrity rollups and graph legacy snapshot behavior.
- Establish a reproducible native SQLite test installation on a supported Node version; pin runtime/dependency compatibility where warranted.

Acceptance:
- All tracked JS passes syntax checks and backend starts.
- Existing graph integrity, store, timing and process-restart tests pass; no skip introduced to hide failures.
- Foreign-user IDs fail in planner, legacy save/import, queue and interval paths.
- A nested project survives a Focus snapshot with identical canonical names, parent IDs, sibling positions and ownership.
- Public index/assets/health/config work; private APIs reject unauthenticated requests; internal source/data requests return no file bytes.
- Upgrade/restart tests preserve representative existing data and migration markers.

## PR 2 — Finish Focus persistence, ending and recovery
Feature rows: 8–16, 17–18, 37.
Sources: graph frontend/task-graph.js, task-graph-timing.js, work-planner.js, persistence.js, core.js and timing.js.

Tasks:
- Use one authenticated work-session creation/restoration path for new lists, resumed lists, selected projects and sorted existing tasks.
- Persist task creation before opening intervals and persist queue selection before entering Focus.
- Ensure new lists never time against a missing or stale activeWorkSessionId.
- Define explicit session lifecycle transitions for pause/interruption, Stop Working, hard stop, completion and replacing a queue.
- Close applicable durable intervals when a session ends; prevent ended sessions from being recovered as active.
- Reconcile server status/elapsed/queue with cached browser snapshots. Do not blindly prefer stale cached task fields.
- Capture actual user-action timestamps before asynchronous operations, retaining rapid start/stop ordering fixes.
- Keep session deadline distinct from task/project due dates.

Acceptance scenarios:
1. New list → Focus → pause → reload → resume.
2. Nested project → complete child → parent totals/status update without structural changes.
3. Delete browser snapshot → recover active queue from server.
4. Restart backend between interval start/stop → recover history.
5. Rapid Done/Next with delayed network → no missing or duplicate intervals.
6. Hard stop/Stop Working/completion → no running orphan intervals or resurrected ended session.
7. Mobile tab suspension/background return → consistent time accounting and no duplicate audible cues.

Decision D4 controls the final time reconciliation policy. Build lifecycle and reconciliation tests independently while that decision is pending.

## PR 3 — Integrate guest entry and preserve estimates
Feature rows: 3, 6, 19–21, 24.
Sources: Ssoplusmvp entry.js, initialization.js, core.js; sso timing continuation; current canonical planner.

Tasks:
- Consolidate bootstrap into one owner for shared scripts. Load graph/authenticated features only for signed-in users.
- Permit useful guest entry without waiting indefinitely for remote configuration/Clerk.
- Guest tasks remain local; no silent upload on sign-in. Separate guest and per-account state, including planner UI keys.
- Preserve active-session token identity checks and local API routing.
- Parse entries into structured records before duplicate resolution. Preserve estimates by occurrence identity, not post-resolution array index.
- Support timed, untimed and mixed multiline inputs. Specify ambiguous single-line comma input with tests rather than turning duration tokens into tasks.
- Reuse decomposition UI after D1. Persist its parent/input/continuation so reload returns to a meaningful state.
- Preserve existing CSV and completed-task import rules.
- Keep duration input optional for project containers where appropriate; executable untimed tasks must receive estimates before timed work starts.

Acceptance:
- "Email Sam, 10m" followed by an untimed "Buy milk" retains 10 minutes and prompts only for the untimed task.
- Fully timed duplicates with different estimates survive rename/remove review with the correct estimate on each remaining occurrence.
- Untimed comma lists, numbered lists and supported CSV/text exports import correctly.
- Guest entry works offline; guest task mutations do not call private server APIs.
- Guest/account A/account B state is isolated across sign-in, sign-out and account switch.
- Authenticated graph recovery still works after changing bootstrap.
- Cancelling or refreshing decomposition does not lose task identity, estimates or newly entered subtasks.

D5 gates server erasure and guest import; neither is implied by Start Over.

## PR 4 — Enforce prerequisite eligibility
Feature rows: 12, 13, 22.
Existing main blocker UI is a starting point, not enforcement: it requeues tasks and clears the dependency pointer.

Tasks:
- After D2, persist prerequisite relationships distinct from project membership and queue order.
- Validate ownership, self-dependencies and cycles.
- One eligibility function must drive queue recommendations, next-task selection and backend interval-start validation.
- Requeueing cannot silently erase the relationship that prevents execution.
- Complete prerequisite → recompute dependent eligibility without losing user ordering.

Acceptance:
- A depends on B: A cannot start before B under the approved completion semantics.
- Reload/restart/export-import where supported preserve dependencies.
- Cycles/self-links/cross-user dependencies are rejected.
- Completing B enables A; a blocked-only queue shows a useful resolution state instead of selecting an ineligible task.
- The next task is eligible under the same rules on client and server.

## PR 5 — Add persisted importance and urgency
Feature rows: 23, 27, 35, 36.
Source: Eisenhower script.js and matrix UI.

Tasks:
- After D3, port ranking and matrix into canonical application navigation without replacing Work/Focus/Plan.
- Persist importance and nullable due dates on existing nodes using additive migrations and authenticated CRUD.
- Importance expresses user ranking; urgency is calculated independently.
- Reuse the prototype formula: latest start = due timestamp − remaining estimated duration. Document how remaining duration is derived after partial work.
- Support tasks without deadlines; do not invent dates merely to place them on the matrix.
- Define timezone input/display behavior, overdue states and changes to duration/deadline.
- Keep queue order separate from importance order.
- Matrix changes must not rewrite existing project hierarchy.

Acceptance:
- Ranking/deadline/duration survives reload and server restart.
- Editing importance changes its axis without changing due date; editing due date changes urgency without changing importance.
- Partial work updates remaining duration under the approved timing policy.
- Missing deadlines, overdue tasks, one-task lists, equal values and nested tasks render sensibly.
- Existing Focus entry, navigation and audio remain usable.

## PR 6 — Smart work selection and trustworthy metrics
Feature rows: 12, 13, 16, 37.
This is new integration work, not a complete implementation recoverable from any branch.

Tasks after D6:
- Combine prerequisite eligibility, importance, urgency, remaining duration and session capacity into an explainable selection policy.
- Preserve an explicit manual order; recommendations do not silently reorder active work.
- State why a task was suggested and expose infeasible deadline/capacity conditions.
- Define metrics from durable records: elapsed work, remaining estimates, estimate-versus-actual and project rollups.
- Avoid double counting local checkpoints and interval totals. Define treatment of cancelled tasks, reopened work and empty projects before reporting totals.
- Reuse MVP exports and main rollups only where their definitions match the approved metric semantics.

Acceptance:
- Deterministic selection fixtures include dependencies, missing deadlines, insufficient capacity and conflicting importance/urgency.
- No ineligible task is suggested or started.
- Project totals equal the documented descendant aggregation.
- Reload/restart and repeated exports do not inflate time or completion counts.
- Selection/metric limitations are clear in UI and PR descriptions.

## Product decisions: proposals, not approved requirements
| ID | Choice requiring Paul's review | Proposed starting point |
|---|---|---|
| D1 | Does decomposition create hierarchy or flatten one list item? | Preserve parent as a project and create canonical children; do not implement until confirmed |
| D2 | Dependency grouping, multiple prerequisites, and cancellation semantics | Explicit prerequisite edges; all required prerequisites must be completed; cancellation behavior needs confirmation |
| D3 | Eisenhower optional view or replacement; ranking scope and project aggregation | Optional view; rank within an explicit task/project scope, with no inferred parent importance |
| D4 | Durable intervals versus browser clocks as authoritative elapsed time | Durable acknowledged intervals for persisted metrics; local clock for immediate display, with explicit reconciliation |
| D5 | Guest/account import and meaning of erasure | Explicit guest import; distinguish local reset, task cancellation and permanent account-data deletion |
| D6 | Smart autopopulation objective and treatment of manual order | Show eligible recommendations constrained by capacity; keep manual order unless user accepts changes |
| D7 | Empty-project completion and container time estimates | Empty projects remain pending; distinguish container estimate from calculated child total |
| D8 | Meaning of Always On and Communicability | Do not infer background execution, offline sync, collaboration or sharing from these labels |

Ask only when the dependent implementation is ready to be made concrete; continue independent repair and data-safety work. Do not treat proposed starting points as user authorization.

## Deferred scope
Track these as separate backlog items, not branch merges:
- Drag-and-drop grouping/ungrouping: reuse main's button-based structural operations.
- Interactive graphical tree: existing hierarchical lists are a foundation, not that feature.
- Gantt and calendaring: require approved due-date, window and scheduling semantics.
- Task time windows: not implemented in audited branches.
- Assignability and communicability: require ownership/permission and sharing decisions.
- Permanent server-data erasure: separate from guest/local reset.

## Completion and reporting
For each PR provide:
- Feature rows addressed and source commits/files reused.
- Before/after user behavior and preserved invariants.
- Tests actually run, manual checks, unresolved failures and product decisions.
- Migration/rollback notes for persistence changes.
- Spreadsheet claims corrected by evidence; do not edit the source matrix unless separately requested.

Do not close backlog issues based only on code presence. Do not delete old branches until unique work is accounted for and deletion is authorized. A documentation commit or a passing unit test is not production deployment verification.
