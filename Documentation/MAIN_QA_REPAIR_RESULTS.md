# Main QA repairs B1–B8

## Branch and baseline

Repair branch: `codex/main-qa-repair`. Intended draft PR base: `codex/focus-durability`.

Fetched/rechecked main `fe514fa3aaa7c4f2ad257d36df62cdd53afc841f`, foundation #73 `e280df37072e2b8bb34767bdb58ed1d36bb808c8`, and Focus #74 `a67640809661a76d4be92c93acdaee8fd5152086`. Both PR pages reported `DRAFT`; neither head was in main. The repair starts at the Focus head and retains the foundation/Focus implementations and branches. No sso/Ssoplusmvp branch was imported.

Read the repair spec from fetched main (it is not present in the Focus base). Tested the selected Focus baseline before changing implementation, then used a temporary archive of that exact commit for isolated supplemental reproductions. This was a disposable baseline fixture, not a Git worktree or production instance.

Observed local baseline `/api/health` version: `task-graph-foundation-v1`. The actual browser loaded `/frontend/auth.js?v=20261013-focus-1` and the bootstrap's initialization, graph, timing, persistence, UI, core, Focus, Work planner, planner, editor and supporting scripts with `v=20261013-focus-1`; deadline audio used `v=20261012-1`. Repair bootstrap/application assets use `v=20261014-qa-1`. The backend version string is unchanged. These are local observations, not proof of the hosted screenshot build identity.

## Before/after evidence

Every B1–B8 behavior below was reproduced on the selected baseline and has a repair regression. No bug is classified as fixed by inspection alone.

| Bug | Baseline reproduction | Repair and verification |
| --- | --- | --- |
| B1 | In Chromium, entering the legacy sequential timing view then calling the sorting transition left `timingEntryScreen` mounted. Plain-name new lists could not reach that flow naturally because of B3. The literal `\\n` after the last script was also present. | Sorting tears down outgoing dynamic content and timer; completed comparisons release their handlers. Removed the markup text. Browser assertions cover the legacy outgoing-screen transition and the full five-task untimed-list journey: sorting has no estimate/deadline/Focus forms, subsequent estimates show one screen, reload recovers paused, and exactly one interval runs in Focus. |
| B2 | Add New Task rejected a name without inline time. Blocker entry accepted a plain name and persisted a zero estimate straight to the dashboard. | Add, blocker, and editor Add Task share missing-estimate collection. Draft insertions are not added to the durable queue before estimate/placement confirmation. Browser tests cover untimed add, blocker, project-child add, cancellation, and valid inline estimates, retaining pause/session ordering. |
| B3 | Blank container time blocked project Continue. With a container time supplied, plain parts triggered “Add a time estimate to every part” for both skip-sort choices. | Container estimate is optional and defaults to zero, without inventing positive timing. Names and inline timings share a structured parser: optional sorting, missing-estimate continuation, then ID-preserving persistence. Browser tests cover both choices, mixed timing and duplicate occurrences (1/2/3 minutes), and nested project creation without a container estimate. Duration-only tokens are rejected rather than becoming task names. |
| B4 | Reopening Plan Edit Project displayed `Timed child` without its saved 45 minutes, while SQLite still held 2,700,000 ms. | Existing graph rows are edited by canonical ID, not matched by name/position in a parts textarea. Prefilled direct edit preserves no-op saves, rename, reorder and duplicate-name estimates. Reload plus backend restart read the edited canonical values. An additional regression exposed old Focus pause snapshots overwriting server edits; snapshots now preserve an existing positive estimate, while still filling missing estimates and saving elapsed work. |
| B5 | Work's nested manager leaf rows had Move/Delete but no Edit. | Each leaf has direct Edit with prefilled name/estimate, Save and Cancel; project metadata editing is separate from adding children. Browser/API/SQLite assertions preserve ID, parent, position, owner, session, created/completed/started fields, elapsed history and incoming blocker references. |
| B6 | Changing Oars's 45-minute leaf to 30 through PUT left Left=180 and Oars=360 in SQLite until a subsequent GET reconciled them. GET then produced the correct 165/345. | Every node mutation explicitly completes canonical reconciliation before acknowledgment; the editor awaits it and fetches fresh rows. Assertions before any GET show Left=165, Oars=345; moving the 15-minute leaf gives Left=150, Right=195, Oars=345, and undo restores Left=165/Right=180. Browser move/undo uses the original 180/180/360 fixture. Historic actual time remains 12,345 ms. No elapsed authority or completion/cancellation policy change. Containers with children display a calculated planned estimate; there is no separate “initial estimate” column to advertise. |
| B7 | Plan Edit Project opened parts entry instead of the recursive editor available through Work Manage. | Explicit project-ID callbacks replace document class/index interception. Plan summary Edit Project and Work Manage enter the same recursive editor. Each new origin resets its history; Back returns to the originating Plan list or refreshed Work overview. Tests cover nested Back, repeated entry, a deleted decoy row, reordered children, and preserved IDs/times. Undo storage is account-scoped, including duplicate review. |
| B8 | Starting Oars, inserting an unrelated standalone task and advancing to it still displayed Oars's toolbar. | Flattened/recovered tasks carry canonical ancestor IDs; toolbar rendering requires the selected project ID to be in the active task's ancestry. New lists/backlog and recovery clear or derive context. Browser tests cover a related Oars task, unrelated insertion, reload, stale cached context, reset to a standalone list, and entire-backlog selection. No inferred deadlines or elapsed-authority changes. |

## Validation

Node 22.23.3, frozen `npm ci`, installed Chromium, actual application bootstrap, and disposable localhost Express/SQLite fixtures. Clerk UI is simulated; backend requests carry locally signed RS256 JWTs and use Clerk signature/ownership verification with an offline fixture public key. No live-account or production task writes.

- Initial new repair regressions: 0/5 passed on the baseline (the assertions intentionally detect the broken behaviors).
- Supplemental baseline observations: 5/5 completed, confirming B2/B3/B4/B5/B6/B7 and recording asset identity. These assert the old failures; they are not repair acceptance tests.
- `npm test`: 55 passed, 0 failed, 0 skipped, 0 cancelled (complete foundation, Focus, browser and backend suite).
- New tests: `tests/main-qa-browser.test.js` and `tests/main-qa-http.test.js` (11 regressions).
- Existing Focus blocker/recovery test now supplies its missing estimate before insertion and retains its graph, queue and recovery assertions; it no longer expects a later zero-estimate Focus prompt.
- Existing delayed starts/stops, lost-response retries, snapshot ordering, hard-stop boundaries, account-switch rejection, server restart, stale closed sessions and SQLite upgrade tests remain passing.
- `git diff --check` passed. No build script is defined; the browser/API tests execute the application rather than substituting a syntax-only check.

Live Clerk sign-in, physical mobile suspension, and physical audio output were not validated. Existing browser audio uses a simulated AudioContext. No merge, deployment, destructive migration, guest import, or production data change was performed.

## Delivery

The implementation and QA are complete. Draft PR creation requires access to `api.github.com`; the current proxy returned CONNECT 403. The environment draft adds only `api.github.com` to the existing custom network rules. Applying it requires the environment settings review/save/publication workflow. GitHub Git access and PR-page reads work; these do not establish API access. PR publication status is reported separately from test results.
