# Codex next specification: connect Focus to the durable graph
Date: 2026-10-13
Repository: pbangiola/nexttask
Previous specification: Documentation/CODEX_FEATURE_INTEGRATION_SPEC.md
Supporting audit: Documentation/BRANCH_AUDIT_CODEX_HANDOFF.md

## Reviewed result
Codex branch: codex/graph-foundation
Reviewed head: e280df37072e2b8bb34767bdb58ed1d36bb808c8
Reviewed main: 2fea12c0d1b590f719811fac5a691f0e7443dbda

Completed in the branch:
- Valid read-only legacy import; original graph syntax error removed.
- Owned work sessions, independently ranked items and interval APIs.
- Ownership/anonymous-ID rejection and atomic queue/snapshot writes.
- Explicit public asset list; backend/database files are not publicly mounted.
- Additive version-3 graph schema; destructive fresh-start reset and legacy-table drops retired.
- Node 22.23.3 runtime, native dependency pin, lockfile and expanded tests.
- Local-origin API routing.

Independently checked during this review:
- npm ci and node --test under Node 22.23.3: 24 passed, 0 failed, 0 skipped.
- Syntax checks on every tracked JS file: passed.
- Foundation commit is not in main. No new foundation PR was returned in the repository PR listing at review time.
- No real Clerk browser, mobile suspension or deployment verification was performed.

This is a completed backend foundation, not completed Focus integration. The author correctly documents that boundary in Documentation/GRAPH_FOUNDATION_PR1.md.

## Objective for the next change
Make the signed-in Work/Focus UI actually use the new durable session, queue and interval APIs, preserving current task semantics and project structure.

Do not repeat foundation work or switch to guest/Eisenhower development yet.

## Branch and delivery
1. Fetch current main and codex/graph-foundation. Recheck whether the foundation has been merged or changed.
2. If foundation remains unmerged, open its missing draft PR against main using GRAPH_FOUNDATION_PR1.md, then create a Focus integration branch from the current foundation head. Open a stacked draft PR against codex/graph-foundation so review shows only Focus changes.
3. If foundation is merged, branch from current main and target main.
4. Do not copy the entire old task-graph-rebuild branch. Reuse selected frontend concepts against the stricter new foundation APIs.
5. Implementation and draft PRs are the deliverables. Do not merge, deploy, reset data or delete branches without separate authorization.

## Scope and starting points
Main UI files retained by foundation:
- frontend/auth.js: does not load graph helpers.
- frontend/persistence.js: snapshots are fire-and-forget and unsequenced.
- frontend/core.js: new-list preparation, beginWork, browser-only startup recovery.
- frontend/work-planner.js: existing/project work selection.
- frontend/timing.js: clocks and hard stop.
- frontend/ui.js: Done/Next, add/blocker, Stop Working/checklist, completion.
Foundation:
- frontend/task-graph-timing.js: present but not loaded; currently catches errors and can silently lose durable timing.
- backend/public-assets.js: explicitly lists assets; no task-graph.js entry yet.
- backend/task-graph-store.js/routes: stricter queue membership, eligibility and retry validation than old graph branch.

### 1. Load one authenticated graph client
Add/adapt frontend/task-graph.js; enumerate it in public-assets.js and load it before TaskGraphTiming/consumers.
Keep current audio, canonical planner and local API routing. Refresh modified bootstrap asset versions, including the outer auth URL, so existing browser caches get the new code.
Preserve authenticated account identity checks; confirm request identity cannot drift on account switch.
Do not load a second bootstrap or restore the old bulk-project override.

### 2. Prepare durable work before Focus
Route new lists, resumed lists, selected projects, selected backlog and sorted existing tasks through one session-preparation operation.
Capture stable canonical task IDs; persist newly created tasks first.
Create a queue containing only pending/active, independently actionable task nodes in approved order.
Keep completed history and project containers out of eligible queue replacement.
Only show running Focus after task persistence, session creation and queue preparation succeed.
Preserve canonical parent/session ownership/name/sibling position while deriving display labels and work rank.

Replace-session safety:
- Preparing the new session/queue must not end the old session on failure.
- Prefer a transactional create-with-items backend operation, or an explicitly tested rollback/cleanup sequence.
- A failed queue write must not leave a newer empty open session that hides the previous recoverable one.
- Store the acknowledged session ID locally; do not reuse a stale ID across unrelated new work.
- Keep the synthetic Sort Tasks record/history intact; do not accidentally queue completed sorting overhead as executable work.

### 3. Serialize complete user actions, not only interval calls
This is the most important compatibility issue:
The foundation rejects a NEW interval for a completed task. The older graph branch allowed some delayed starts based on timestamps. Do not assume its frontend bridge can be dropped in unchanged.

For a task that enters Focus and is immediately completed, enforce:
persist task + queue → acknowledge start interval → stop interval at captured action time → persist completed state → enter next task.

Also serialize snapshots so an older active snapshot cannot arrive after a completed snapshot.
Capture timestamps when the user acts, before awaiting network operations.
Track retryable operation IDs across retry/reload. Reuse an interval ID after an uncertain response; do not generate another ID that creates a second interval after an already-closed retry.
Do not resolve a rejected durable operation as success. Show a concise pending/failed save state with a retry action and prevent duplicate transition submissions.
A local optimistic display may remain responsive, but it must not claim durable completion while writes are unresolved.

Acceptance: delayed start, immediate Done/Next and response loss after commit preserve exactly one interval per intended run and the final completed state.

### 4. Preserve lifecycle boundaries
- Pause/interruption: close the task interval at the captured boundary; session can remain open for resumption.
- Done/Next: close interval, persist completion, choose the next eligible queue task and open its interval.
- Add task: persist canonical row, update the durable queue, then permit execution.
- Blocker insertion: preserve existing blocker semantics; exclude blocked nodes from executable queue and do not silently erase their relationship. New multi-prerequisite behavior remains outside scope.
- Stop Working: stop the active clock/interval, present checklist, then persist selected completions and end the durable session when the user confirms.
- Natural completion: finish pending writes and end the durable session.
- Hard stop: use hardStopAt as the interval boundary, even if detection occurs later. Stop interval at that boundary before calling session end; the current endSession fallback uses server time.
- Starting over/replacing work must not abandon an open interval. Preserve data and explain any legacy-state fallback.

All lifecycle operations must be idempotent. Do not reopen an ended session or restart completed work on retry.

### 5. Recover queue and state without flattening projects
On startup:
- Verify active account and discover owned open session.
- Fetch queue/current canonical status and open intervals.
- Validate cached active session ID against server state; completed/ended server state cannot be resurrected by a stale browser snapshot.
- Recover display labels/project context from canonical structure rather than writing prefixed names back.
- Support server-only recovery when browser storage has been deleted.
- Provide explicit retry/fallback when discovery fails; do not overwrite recoverable server work with an empty local list.
- Expired hard stops close intervals using the recorded deadline before resuming navigation.
- Repeated recovery cannot create duplicate sessions or intervals.

Account isolation: local state and outstanding writes must be tied to the account that created them. Account switch must cancel/reject stale work, not authenticate it as the new user.

### 6. Keep elapsed-time policy changes explicit
D4 (intervals versus browser time as persisted elapsed authority) is still unapproved.
Proceed with session/queue/lifecycle integration and record intervals accurately.
Preserve existing canonical elapsed_ms and browser display behavior; do not replace totals with interval sums, add both together or infer unrecorded historical work.
Server-only recovery can show existing acknowledged elapsed_ms and paused recovered state with an explicit resume action. Do not claim fully reconciled cross-device time until D4 is decided.
Implement elapsed reconciliation as a separately reviewable part after the decision. The PR must state this limit.

## Required regression and integration checks
Keep all 24 foundation tests passing and add meaningful coverage for:
| Scenario | Expected result |
|---|---|
| Fresh timed list, with and without sorting | Canonical tasks saved, durable queue ordered, Focus interval created |
| Existing nested project | Work labels and rank do not change canonical name/parent/position |
| Rapid Done before delayed start responds | Start/stop/completion ordered; no rejected missing interval or duplicate run |
| Lost start/stop response and retry | Same durable operation reused; exactly-once effect |
| Consecutive snapshot requests delayed out of order | Final stored task state remains newest |
| Failed new queue preparation | Old session stays recoverable; no orphan empty session hides it |
| Add task and blocker during Focus | New rows exist before queue/interval references; ineligible task not started |
| Stop checklist and natural completion | All relevant writes acknowledged; session ended; no open interval |
| Late hard-stop detection | Interval ends at hard stop, not at late detection/recovery |
| Reload with/without local storage; backend restart | Owned queue restored without extra sessions or structural changes |
| Stale local completion/session versus server | Server closed state is not resurrected |
| Account switch during pending writes | Other account's state/data not read or mutated |
| Browser/mobile background and resume | No duplicated interval/audio; limitations documented |

Use disposable SQLite fixtures and actual HTTP APIs for end-to-end persistence assertions. VM stubs alone are insufficient for write ordering.
At least one browser integration check must exercise the loader, new-list entry and Done/Next with controllable network delay. Offline signed-token tests can cover HTTP ownership but do not substitute for live Clerk sign-in. Document real browser/mobile checks as run or not run.
Use same-origin localhost backend for testing; never production task writes.

## Out of scope
Guest flow, decomposition redesign, scheduling/prerequisite model expansion, Eisenhower, metrics redesign, permanent deletion and spreadsheet editing.
D1–D8 in the original spec remain open. Existing semantics can be preserved without resolving them all.

## Deliverables
- Foundation draft PR if still missing.
- Focus integration draft PR based on that foundation/current main.
- Documentation/FOCUS_DURABILITY_PR2.md with reused source changes, behavior, tests actually run, failures/limits and D4 separation.
- Evidence that main's canonical planner, estimates, audio and data-preserving migration behavior remain intact.
