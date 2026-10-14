# NextTask 2.0.0-beta.1 — integrated beta

Version date: October 14, 2026 (America/Chicago). Backend health version:
`nexttask-integrated-beta-1`. Complete integration targets current `main` through
`codex/integrated-beta`; original feature branches remain intact.

## Recovery and branch accounting

PR #74 was merged into the subsequently deleted graph-foundation branch, not
main. Its recoverable head `617f7fb` also contains repair PR #75. From main
`5954d26` (foundation PR #73 already present), this integration cherry-picks
`a676408` (Focus durability), `d201773` (B1–B8), and `8d05f13` (repair evidence),
then builds the combined beta. Main's newer documentation and QA material are
retained. No production tasks, users, owners, elapsed values, or branch histories
are erased or reset.

| Inspected source | Useful disposition |
| --- | --- |
| sso `32e325f` | Shared bootstrap/auth foundation already present; no duplicate loader/store imported. |
| Ssoplusmvp `9890d4a` | Rebuilt bounded guest entry and mixed structured records on shared lifecycle; rejected name-based identity/comma fallback. |
| task-graph-rebuild `a590b42`; `e73c4f5`, `82b59b1` | Optional estimates and graph concepts superseded by recovered canonical graph/B1–B8 repair. |
| Eisenhower `746ee9d` | Rebuilt pairwise ordinal importance, deadline, latest-start/slack and optional quadrants on owned canonical IDs. |
| MVP `4df391a` | Rebuilt local entry and estimate/actual/variance CSV; did not import old identity model or deleted data. |

## Resulting behavior

Guest entry works when configuration/Clerk is offline or slow: an explicit button
and bounded 1.5-second startup fallback use the existing application loader once.
Guest state stays in separate local browser keys, makes no private API requests,
and is never automatically uploaded on sign-in. Sign-in remains an explicit
transition. Guest Plan is unavailable; local task entry, sorting, Focus, resume,
importance, and metrics use the shared interface. Clearing browser storage loses
guest data. Local storage failure is visible and stops successful-save reporting.

Entry accepts untimed names and explicit duration records, including
`Alpha, 5m, Beta`. Plain commas in `Discuss X, Y` remain part of a name; invalid
or duration-only tokens do not become tasks. Duplicate occurrences retain
separate IDs and estimates. All queue insertion paths resolve missing estimates
before starting their interval. Long-task decomposition remains the existing
flat beta behavior pending a product decision.

Plan and Work use the same ID-based project editor. Optional upfront project
estimates, direct leaf/root editing, move/group/ungroup, awaited bottom-up rollups,
parent navigation, and active-task ancestry are preserved. Retained history is
explicit in calculated project totals. Blocked-only selections show why no Work
session can start and preserve prerequisite links.

Authenticated Focus retains its durable action journal, idempotent captured-run
interval writes, acknowledged Done/Stop, paused recovery after reload, and account
isolation. Actual time remains canonical acknowledged elapsed; interval history
is audit evidence, never an additional sum. Sorting overhead remains attributed
under the existing policy. Guest local persistence does not claim a remote retry
journal or cross-device durability.

Optional importance/deadline metadata lives in an additive owned SQLite table,
not canonical task order. Full-scope rank updates validate ownership and scope
atomically. Pairwise comparison can be cancelled without saving. Names show
ancestor context and IDs when still ambiguous. Dates use UTC milliseconds in
storage and the browser timezone in the editor. Missing ranks/dates are explicit.
Remaining = max(estimate − acknowledged actual, 0); latest start = deadline −
remaining; slack = latest start − now. The top half of explicit ranks and slack
≤ 0 define **illustrative** quadrants, not an approved capacity optimizer. No
importance action silently replaces the active Focus queue.

Hierarchy metrics display estimated, acknowledged actual, and actual-minus-
estimate variance in minutes. CSV includes canonical IDs, parents, node types,
status, quoted names, and leaf totals including retained history. Each task is
counted once in the summary; project rollups are displayed but not summed again.

## B1–B8 disposition

All eight recovered repairs are retained and exercised by the inherited QA suite;
see `MAIN_QA_REPAIR_RESULTS.md` for individual reproduction/evidence.

| Repair | Integrated result |
| --- | --- |
| B1 | Screen/timer teardown and markup repaired; no literal backslash-n display artifacts. |
| B2 | Missing estimate continuation across entry, blocker, replacement, and insertion paths. |
| B3 | Optional project estimates and untimed project parts. |
| B4 | Canonical occurrence identity and prefilled estimate retention. |
| B5 | Direct leaf edits preserve ID, owner, elapsed, and relationships. |
| B6 | Awaited immediate ancestor estimate rollups, move/group/ungroup/undo. |
| B7 | Shared explicit-ID editor and parent/back behavior across Plan and Work. |
| B8 | Toolbar derives actual task ancestry; standalone/unrelated tasks have none. |

## Feature-matrix accounting

Read-only source: [TaskSorter comparisons](https://docs.google.com/spreadsheets/d/121ZmtFI-BeVkAZcvRqq9Fq1XQQIGP4D-_PcQDcVW8eU/edit),
Sheet1 and Sheet2 A1:N100, rows 2–37. Historical feature/bug/wishlist booleans
are source claims, not acceptance evidence. Every named row is classified below.
“Working automated” means exercised locally by this beta suite, not live
production acceptance. “Partial” explicitly limits the implemented subset.

| Row / feature | Beta classification | Evidence or limit |
| --- | --- | --- |
| 2 Platform Durable | Partial | Authenticated SQLite/journal/restart tests; guest is device-local; production volume readback still required. |
| 3 (Easily)Erasable | Planned | Permanent account/anonymous erasure policy unresolved; no destructive feature introduced. |
| 4 Mobile | Partial | 390px browser viewport tested; physical mobile/touch acceptance remains manual. |
| 5 Always On | Planned | Background/sleep/continuous behavior requires product policy. |
| 6 Simple | Implemented-unverified | Shared entry/guest controls implemented; usability acceptance remains subjective/manual. |
| 7 Focus Mode | Working automated | Queue/run lifecycle and combined browser journey. |
| 8 Resumable | Working automated | Reload restores paused authenticated and guest sessions. |
| 9 Interruptable | Working automated | Stop/replacement/recovery and captured interval tests. |
| 10 Autopopulated from tasks | Working automated | Owned recursive eligible Work selection. |
| 11 Enforced order | Working automated | Explicit persisted queue order and optional-view invariance. |
| 12 smart autopopulation | Partial | Eligibility/prerequisite filtering; no inferred importance optimizer. |
| 13 Fills in correct next task to focus | Partial | Explicit eligible order/blocker replacement; scheduling policy unresolved. |
| 14 Feeds back to tasks | Working automated | Acknowledged elapsed/status and terminal retry protection. |
| 15 Feeds back to projects | Working automated | Bottom-up rollups and ancestry updates. |
| 16 feeds back to metrics | Working automated | Canonical acknowledged metrics/CSV browser tests. |
| 17 timed | Working automated | Estimate gating, captured runs, idempotency and elapsed authority. |
| 18 Deadline alarm | Implemented-unverified | Existing timer/alarm path retained; actual speaker/background/mobile alarm checks remain manual. |
| 19 Complex Task Mode | Partial | Projects/blocks supported; flat long-task decomposition not approved as persisted children. |
| 20 Subtasks | Working automated | Owned canonical child tasks/project parts and nested editing. |
| 21 Prioritzable subtasks | Partial | Existing explicit child order and optional open-actionable importance; parent-derived importance unresolved. |
| 22 Enforced/grouped prerequisites | Partial | Structural predecessor/link eligibility tested; multiple prerequisites/cancellation policy unresolved. |
| 23 Urgency based prioritization | Partial | Explicit latest-start/slack view; does not reorder Focus or optimize capacity. |
| 24 Task Durations | Working automated | Timed/untimed entry, required continuation and estimates/actuals. |
| 25 Task time windows | Absent | Optional due date is not an availability window. |
| 26 assignability | Absent | No sharing/cross-owner assignment introduced. |
| 27 Deadlines | Partial | Owned due metadata/restart persistence; alarm scheduling not extended. |
| 28 Projects | Working automated | Optional estimates, direct editing, rollups, Plan/Work combined journey. |
| 29 Drag and drop grouping/ungrouping | Partial | Explicit Move/Group/Ungroup buttons work; no drag-and-drop claim. |
| 30 Tree visualization | Working automated | Nested editor and hierarchy/metrics tree. |
| 31 Gantt visualization | Planned | Wishlist; no Gantt introduced. |
| 32 Calendaring | Planned | Wishlist; no calendar integration introduced. |
| 33 Communicabiility | Planned | Wishlist; no sharing/communication integration introduced. |
| 34 Arbitrary depth and nesting | Partial | Canonical nesting supported/tested with safety guards; unbounded depth not promised. |
| 35 Systematic importance | Partial | Owned ordinal pairwise/full-scope ranking tested; scope/parent inheritance choices explicit. |
| 36 Eisenhower visualization | Partial | Optional illustrative quadrants; thresholds are a proposal. |
| 37 Metrics | Working automated | Units, CSV escaping, canonical IDs, leaf-only summary and acknowledged actual tests. |

## Product decision register and next work

| Decision | Current safe beta behavior | Needed decision / next work |
| --- | --- | --- |
| D4 elapsed reconciliation | Acknowledged canonical/browser elapsed is authority; never sum interval durations. | Approve reconciliation semantics before changing historical elapsed. |
| Long-task decomposition | Existing flat workflow retained. | Decide persisted canonical child lifecycle versus temporary queue parts. |
| Prerequisites/cancellation | Existing single structural link and retained history. | Multiple prerequisites, cancellation effects and retained-rollup policy. |
| Importance scope | Open independently actionable owned tasks, including blocked; no parent inheritance. | Confirm scope, project inheritance and completed/cancelled rank handling. |
| Urgency/optimizer | View proposal only; no queue replacement. | Capacity, time windows, weighting, thresholds, and explicit apply action. |
| Erasure/anonymous attribution | No permanent erasure or implicit anonymous merge. | Retention, attribution, audit and deletion policy. |
| Guest import | Separate local data; no automatic upload. | Explicit preview/conflict/ownership import design. |
| Assignment/sharing | Own-user boundaries unchanged. | Access model and invitation/assignment decisions. |
| Always On | Existing foreground timer; paused reload. | Background/sleep and platform guarantees. |

Recommended next milestone: live Clerk plus physical mobile/audio acceptance,
production persistent-volume/restart verification, then resolve D4/decomposition
and prerequisite semantics before extending scheduling or sharing. Wishlist rows
remain visible; they are not silently marked done.

## Validation and deployment gate

Clean frozen install: 119 packages; Node 22.23.3, better-sqlite3 11.10.0,
Playwright 1.56.1. Syntax and whitespace checks passed. Full local suite:
**64 passed, 0 failed, 0 skipped** using system Chromium 154.0.8037.57.
After small comparison-cancellation/context improvements, browser regressions are
rerun separately and recorded in progress notes. Lockfile-matched Chromium
141.0.7390.37 (build 1194) download was blocked by proxy HTTP 403 **Domain
forbidden**, not an invalid Clerk credential. GitHub Actions installs that matched
browser and runs the complete suite before merge eligibility is assessed.

Exact environment action: enable **Agent internet access** for this Codex
environment and add `cdn.playwright.dev` and
`playwright.download.prss.microsoft.com` to its **domain allowlist**, then rerun
`node node_modules/playwright/cli.js install chromium`. For shell GitHub API and
production verification also allow `api.github.com`,
`nexttask-production.up.railway.app`, and `pbangiola.github.io`. Existing proxy
variables point to the managed proxy; do not disable it or expose credentials.
No Clerk credentials were changed and no evidence currently establishes they
are invalid. No Docker dependency is required.

Live Clerk sign-in, physical mobile/touch, actual sound output, and deployed
volume restart are **not** established by the local/offline-token suite. Merge and
deployment results belong in the PR/final delivery after actual CI/readback;
this document does not assert a deployment merely because main is updated.
See `INTEGRATED_BETA_LOCAL_QA.md` for reproducible local acceptance.
