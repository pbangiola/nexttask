# Single Codex run: consolidate NextTask into a coherent beta
Prepared 2026-10-13, America/Chicago.
Repository: pbangiola/nexttask
Current main audited: f9a45bd2b9894ebd952115a7db6ac2c215ed5942
Feature source: TaskSorter comparisons, Sheet2 flags aligned to Sheet1 names:
https://docs.google.com/spreadsheets/d/121ZmtFI-BeVkAZcvRqq9Fq1XQQIGP4D-_PcQDcVW8eU/edit

## Mission
One sustained implementation run, one integration branch, one final reviewable PR against main. Deliver a usable beta that combines recoverable Focus, straightforward entry, directly editable nested projects, reliable timing, guest use, and optional importance/urgency views. Preserve task IDs, account ownership and existing data. Do not split the user into repeated planning/handoff cycles.

Read the detailed requirements below, execute through verification and local QA packaging, and deliver one concrete result. Use internal commits/checkpoints as helpful; one run does not mean one unreviewable commit.

## Fresh branch inventory and provenance
| Source | Audited head | Disposition |
|---|---|---|
| main | f9a45bd | Foundation from PR #73 is already incorporated. Keep safe assets, additive migrations, Node 22 and ownership tests. |
| sso | 32e325f | Shared ancestor improvements; inspect only where not already covered. No wholesale merge. |
| Ssoplusmvp | 9890d4a | Port untimed/mixed entry, timing continuation, guest UI concepts. Rebuild its bootstrap against current authenticated durability. |
| task-graph-rebuild | a590b42 | Port optional project/subproject estimate changes (e73c4f5/82b59b1) and useful documentation. Old backend/boot/recovery code is superseded; do not import its syntax error or unsafe static mount. |
| Eisenhower | 746ee9d | Port pairwise importance and deadline/duration/slack matrix as optional views over canonical IDs. Do not replace index or introduce an independent task store. |
| MVP | 4df391a | Reference for concise guest entry and estimated/actual/variance CSV. Do not import backend deletions or old time/identity model. |

Deleted remote branches:
- codex/graph-foundation: source e280df3 is in main via PR #73.
- codex/focus-durability: source a67640809661a76d4be92c93acdaee8fd5152086 is NOT in audited main.
PR #74 was merged into the foundation branch after main's foundation merge. PR #74 merge commit: f78b83a05744a5c1b9aeddb02f36a67bec4fa5a6.
The deleted branch's change remains available through PR #74 and its commit objects. Do not interpret the closed/merged PR as proof Focus is on main.

## Run setup
1. Read repository instructions and fetch current main/all live branch refs. Recheck main and PR #74; they may have moved.
2. Create codex/integrated-beta (or a fresh equivalent) from current main.
3. If main still lacks a676408, retrieve the PR head commit using authenticated Git/GitHub resources. For Git, fetch the SHA or refs/pull/74/head, verify its relationship to e280df3, then cherry-pick the Focus commit or apply its equivalent change. Preserve main's newer documentation and QA scripts.
4. Verify graph foundation and Focus tests before building new features. Historical evidence: foundation independently passed 24 tests; Codex reported 44 Focus tests. This is not evidence that new integrations pass.
5. Maintain Documentation/INTEGRATED_BETA_PROGRESS.md with source provenance, completed work, tests and unresolved decisions. Continue independent work if one item is blocked.

## Work package A — Recover and stabilize durable Focus
Import PR #74's client, action journal, atomic work preparation, session/interval lifecycle, recovery and account isolation. Follow Documentation/CODEX_NEXT_FOCUS_DURABILITY_SPEC.md.
Preserve:
- snapshot → queue/session preparation → start acknowledgement → stop → completion snapshot → next task ordering;
- stable request IDs and retry after lost responses;
- canonical graph positions independent of work rank;
- hard-stop timestamp boundaries, paused recovery and ended-session protection.
Do not add interval totals to existing elapsed_ms. Persisted elapsed authority remains unchanged until separately decided.
Real Clerk browser sign-in and mobile suspension are distinct checks from simulated auth/browser fixtures.

## Work package B — Fix all eight observed QA failures
Documentation/CODEX_MAIN_QA_REPAIR_SPEC.md is authoritative for B1–B8 and includes screenshot transcripts; images are not required.
Resolve:
B1: remove stale timing/Focus controls below sorting; one workflow screen.
B2: all untimed insertions, including blockers, collect missing estimates safely.
B3: project names/parts do not require inline timings or a container estimate.
B4: saved estimates repopulate editing and stay attached to canonical IDs.
B5: direct leaf-task name/estimate editing, not a trip back to bulk entry.
B6: nested totals refresh after edit/add/move/delete/undo.
B7: Plan and Work reach the same ID-addressed recursive manager with correct Back behavior.
B8: project timing appears only for related active work; no stale global context.
Remove visible literal backslash-n markup. Test transition/reload/cancel and delayed saves.

Required fixture: Oars → Left (45,60,60,15 = 180), Right (90,90 = 180), root 360. Change 45 to 30: Left165/root345. Move15 between groups: root remains345. Undo restores previous appropriate totals.
Separate absence of database timing from absence in UI. Never recreate rows to repair display.

## Work package C — Unify entry and guest use
Port Ssoplusmvp's useful structured mixed-input parsing, then correct its ambiguous comma fallback and duplicate occurrence handling.
- Name-only, timed and mixed multiline input supported.
- Optional inline estimates; dedicated continuation for missing estimates.
- No duration tokens becoming task names.
- Preserve estimates through rename/reorder/duplicate resolution by entry/task identity.
- Shared code serves Work and Plan; do not reactivate project-bulk-create.js overriding handlers.
- Guest can enter/sort/time a local list without sign-in and without private server writes.
- Guest startup remains useful when config/Clerk is unavailable or slow.
- One bootstrap owns shared scripts. Authenticated mode retains PR #74's account checks/journals/recovery and local routing.
- Guest storage and each account's UI/state are isolated.
- No automatic guest upload. Provide a clear explicit import action only if ownership and ID conflict handling are tested; otherwise document import as deferred without losing guest data.
- Local Start Over clears that local experience, not server account data. Do not imply permanent erasure.
- Keep long-task decomposition behavior explicit. Do not copy flat replacement while labeling it a persisted project. The parent-to-project conversion choice remains unresolved; other work continues.

## Work package D — Baseline eligibility and prioritization
Preserve the existing tested single-blocker behavior: blocked task cannot enter executable Focus, prerequisite completion makes it eligible, reload preserves the link.
Keep task order as user intent and expose why a task cannot run. Test cycles/self-links/foreign ownership if dependency editing is exposed.
Do not silently convert the model to arbitrary multiple prerequisites or assign meaning to cancellation; those are follow-on decisions.
For smart autopopulation, implement the already-supported baseline: eligible canonical tasks, preserved selected/manual order, and a clear blocked-only state. Do not claim an optimized deadline/capacity scheduler exists.

## Work package E — Optional importance, deadlines and Eisenhower
Port the prototype into an optional view; Work/Focus/Plan continue unchanged.
- Additive, owned fields for nullable due timestamp and explicit importance ordering/scope.
- Pairwise ranking uses existing canonical nodes; does not mutate hierarchy or active queue.
- Importance and urgency remain separate.
- Prototype formula: latest start = due time − remaining estimated duration; slack = latest start − now.
- Missing deadline means unspecified urgency; do not invent dates.
- Display timezone and overdue behavior clearly.
- Document the chosen scope for ranking and remaining-duration calculation; do not infer project importance from children.
- Let the user inspect/reorder recommendations explicitly. No silent replacement of active order.
This package is a reviewable optional feature proposal, not permission to replace the established workflow or implement unapproved optimization policy.

## Work package F — Useful metrics and structural inspection
Use current acknowledged elapsed_ms and estimates for estimated/actual/variance per task and bottom-up project totals. Reuse the MVP CSV idea with canonical IDs, units and labels.
Do not promise advanced reconciled cross-device metrics while elapsed authority is unresolved. Do not double count interval sums, project containers and descendants.
Provide an expandable hierarchy view with direct Edit/Move/Group/Ungroup actions on canonical IDs. Existing button actions are the baseline.
If adding drag-and-drop, call the same validated structural operations; include keyboard/button equivalents, cycle prevention, failure recovery and correct totals. Do not make dragging the only way to edit.
No Gantt/automatic calendaring dependency is required for the integrated beta.

## Product decisions and run behavior
The run may complete all existing integration, QA repairs and safe optional views without resolving everything.
Maintain a short decision register rather than making silent choices:
- long-task splitting as flat list versus persisted parent/child project;
- durable intervals versus snapshots as elapsed authority;
- multiple prerequisites and cancellation semantics;
- ranking scope and parent importance;
- optimization policy combining importance, urgency, duration and capacity;
- permanent erasure/legacy anonymous attribution;
- assignment/sharing permissions and meaning of Always On.
Existing behaviors may be preserved. Optional feature proposals must be identified in the PR and kept from silently changing existing user flows.
Do not call a blocked product choice a completed feature. Continue independent implementation/testing instead of stopping the whole run.

## Remaining roadmap after this run
| Phase | Features | Prerequisites |
|---|---|---|
| Beta validation | Live Clerk, physical mobile/background, audio, deployment/readback, fix findings | Integrated beta and configured local/staging environment |
| Scheduling | Task time windows, capacity/urgency recommendations, internal calendar, Gantt | Approved optimization, timezone/window/dependency policy; durable due fields |
| Collaboration and control | Assignability, sharing/communicability, permanent erasure, explicit guest import if deferred | Permission model, recipient/account attribution, deletion scope, conflict handling |
| Metrics maturity | Interval-authoritative reconciliation, cross-device accounting, historical reporting | Elapsed policy and migration/backfill decisions |

Treat calendar/Gantt and assignment/sharing as new development, not recoverable branch features. Do not expand this run into an unapproved collaborative product.

## Full verification gate
- Node22.23.3, locked dependencies; install branch-matched Playwright Chromium in the test environment.
- All inherited tests pass without skipping known failures.
- Browser+real disposable SQLite/API tests cover B1–B8, mixed input, guest/auth isolation, nesting, estimates, retries, selected/manual order, matrix persistence and metrics units.
- One complete session: guest entry → local persistence; separate authenticated entry → project creation without upfront timings → missing-estimate continuation → direct nested edit → rollup → Work → blocked/add task → pause/reload → Done/Next → Stop Working → standalone list without stale project toolbar.
- Repeated sorting/editor navigation never exposes old controls or duplicate timers.
- Migration/restart retains existing rows/IDs/ownership/reset markers.
- No production task writes for tests. Live auth/mobile/audio/deployment checks explicitly reported as run/not run.
- Package every user-facing JS asset in the allowlist/loader and update cache identifiers consistently.
- Syntax and diff checks pass. Any unavailable environment check is documented precisely, not reported as a feature failure or as passed.

## Final delivery
One PR against current main with:
1. One coherent integrated application.
2. Documentation/INTEGRATED_BETA_VERSION_NOTES.md: every matrix feature classified as working in automated tests, implemented/unverified, partial, planned or absent; distinguish core beta from remaining wishlist.
3. A single local debugging/QA runner for the integration branch/current main, plus concise macOS instructions. Existing two scripts refer to deleted Codex branches: repair or replace them; do not leave instructions cloning nonexistent refs.
4. Evidence for each B1–B8 and a manual QA checklist.
5. Branch feature accounting: reused, superseded, duplicate or deferred; original live branches preserved.
6. Remaining decision register and roadmap.
Do not merge or deploy automatically. Prepare the finished tested result for one final review; do not require the user to assemble a series of partial feature branches.

## Immediate Codex instruction
Read this document and the two referenced detailed repair/durability specs. Execute the integrated beta run end to end on a branch from current main. Recover PR #74 first, preserve backend safety, repair B1–B8, integrate entry/guest improvements and optional prioritization/metrics views, test the combined workflows, and open one complete PR with version notes and local QA instructions. Keep unresolved semantic choices explicit without blocking independent work.
