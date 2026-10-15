# October 15 main project QA repair

Base inspected: main 38556cb (includes the integrated beta; newer mobile/auth
repair specification is documentation, not a deployed implementation). Branch:
`codex/main-project-qa-repairs`. No historical feature branches are merged.

## Phase 0 model and reproduction

One canonical SQLite `tasks` table stores leaf tasks and project/container nodes.
`id` is stable; `user_id` is the authenticated Clerk owner; `parent_id` is the
canonical hierarchy edge and `project_id` is its compatibility mirror.
`node_type` distinguishes task/project; `independently_actionable` gates Focus.
`estimated_ms` and acknowledged `elapsed_ms` are separate integer milliseconds.
Status is pending/active/blocked/completed/cancelled, with Unix-ms timestamps.
Work session rank/interval audit are separate tables, not another project store.
Owned nullable `task_priorities.due_at` and pairwise `importance_rank` represent
urgency inputs and explicit importance. Queue insertion position, hierarchy
position, root grouping IDs and duplicate-name similarity are not extra priority
dimensions. No numeric third priority score was found.

Reproduced before implementation with new API/SQLite and browser regressions:
- Empty projects disappear via a MutationObserver that removes rows based on
  unfinished children; completed projects disappear from root queries and filters.
- The shared editor only opens project nodes, has no Add subtask on tasks, and
  parent validation rejects tasks. Existing in-place conversion is only reachable
  through the older creation/estimate prompt.
- Project rollup includes cancelled (soft-deleted) estimates and skips empty
  parents. Deleted children therefore leave totals unchanged, and moving the last
  child leaves a cached estimate. Editor children queries also hide completed rows.
- Node editing ignores completion status; completing from Focus uses snapshots
  but totals refresh on later graph reads. Multi-request UI grouping/moves can
  partially commit. Direct task editing incorrectly requires a positive estimate.
- Urgency treats missing duration as zero; Choose Priority is actually an insertion
  position prompt. The existing optional importance ranking must remain separate
  from duration/deadline and must not silently replace active queue order.

## Migration plan (reported before implementation)

Add schema marker 5 and two additive columns to the existing tasks table:
- `estimated_from_children INTEGER NOT NULL DEFAULT 0`: once a container has
  children, its estimate is derived, including zero after removal of the last
  child. A never-decomposed empty project's optional estimate remains meaningful.
- `own_elapsed_ms INTEGER NOT NULL DEFAULT 0`: acknowledged work on a former leaf
  retained when that same ID is promoted to a container. Container actual is this
  retained own history plus descendants once, never interval sums.

Existing projects with historical children are marked derived; no existing IDs,
owners, estimates, elapsed, status, or reset/data-migration markers are reset by
migration. Existing empty project estimates are preserved because prior intent
cannot be inferred. Previously lost history is not fabricated. New promotion
captures the existing leaf actual and preserves its ID/history/metadata.

Established estimate rule: children replace a nonempty container's own estimate;
never sum the old leaf estimate plus its children. Cancelled/deleted nodes do not
contribute planned estimate. Completed children remain in planned estimates and
editors. Retained deleted actual remains historical actual, explicitly separate
from remaining executable work. Reconciliation is the single backend aggregate
writer, in the same transaction as graph mutation. No independent frontend
project-total calculation is introduced.

Parent completion: preserve automatic completion when historical children have
no open descendants. A newly added/reopened open child reopens completed
ancestors, not siblings. Explicit completion of a parent with open descendants
is rejected instead of silently cascading. Cancelled parents must be restored
before adding work. Timing-active leaf conversion/completion/deletion requires
pausing/stopping first so graph edits cannot abandon a live interval.

## Evidence and delivery

Implementation, verification, 17-behavior regression mapping, manual QA and
remaining decisions are recorded below as the run completes. No automatic merge.

## Implemented repairs and changed files

| Defect / layer | Root cause | Result |
| --- | --- | --- |
| Project discovery (query + UI) | Open-only roots, frontend completed filtering and a DOM observer removed empty/completed project cards. Work selection relied on open-project filtering. | Non-deleted root projects, including empty and completed, are discoverable. Resume reads the authenticated tree afresh. Completed projects remain manageable while Start is disabled when there is no unfinished work. |
| Recursive editing (UI + validation) | Only project nodes could own children; leaf editor had no route to decomposition. | Every canonical editor exposes Add subtask. First-child insertion promotes the same task ID inside the insertion transaction. Repeated nesting uses the same editor, with existing children visible. A nonblocking opportunity after insertion offers further decomposition or Keep as one task. |
| Estimate edit/delete (aggregate + UI) | Cancelled estimates were included; no-child containers skipped rollup; leaf editor rejected missing estimates and some minute inputs truncated decimals. | Non-deleted children determine derived estimates, including zero after the last removal/move. All ancestors update before acknowledgment. Optional zero/untimed estimates can be edited and deferred; input converts once to integer ms without whole-minute truncation. |
| Child completion (API + discovery) | Canonical edit ignored status; child queries hid completed rows; completed ancestors were never reopened on new work. | Explicit Complete/Reopen writes one node. Siblings stay unchanged. Completed children remain visible; progress/remaining estimates are read from the backend. Existing automatic parent completion is retained, and new open descendants reopen completed ancestors. |
| Cross-project editing (graph mutation) | UI multi-selection/group/insertion/sorting performed independent requests; source-empty totals and completed-child ungrouping were incorrect. | Shared editor uses transactional batch operations. Move preserves subtree IDs, relationships, estimates, actuals and completion. Group/ungroup/undo retain completed history. Invalid/cyclic/foreign operations roll back, including earlier steps in a batch. |
| Priority dimensions (labels + formula) | Choose Priority meant insertion position; missing duration was treated as zero in urgency. | Label is Choose Work Position; legacy root grouping metadata is named projectRootId. Importance remains user pairwise ordinal order. Urgency uses due − max(estimate − acknowledged actual, 0) − now only when date and estimate exist. No third independent input, score, weighting formula or automatic queue replacement. |

Implementation files:
- `backend/database.js`: additive schema 5, shared internal SQLite connection,
  and snapshot completion plus reconciliation in one transaction.
- `backend/user-store.js`, `backend/tree-integrity.js`, `backend/user-routes.js`:
  owned discovery, recursive promotion, validated completion, backend progress,
  single rollup authority, atomic move/group/order/insertion/undo, cycle/ownership
  checks and active-interval safeguards.
- `frontend/planner.js`, `frontend/work-planner.js`,
  `frontend/project-editor.js`, `frontend/project-queue-filter.js`: consistent
  discovery, recursive editing, optional estimates, completed history and backend
  totals. The old filter asset remains as a harmless compatibility stub.
- `frontend/ui.js`, `frontend/beta-insights.js`: position label, explicit missing
  urgency inputs, and CSV summary that counts retained former-leaf actual once
  while excluding deleted estimates.
- `frontend/auth.js`, `index.html`: shared cache release identifier only,
  `20261015-project-qa-1`; authentication/credentials/routing are unchanged.
- New project QA HTTP/browser/migration tests; inherited browser selectors updated
  solely for the position label, and the schema-version assertion includes 5.
  No inherited test is skipped or removed.

The existing duplicate-review module's explicit **Delete Task** confirmation is
preserved. Its delete operation uses the same canonical API and undo data; it
is not another store or aggregate authority. The existing optional 20-minute
breakdown suggestion remains a suggestion, not a maximum task duration.

## Automated evidence

Before implementation: clean Node 22.23.3 frozen install (119 packages), inherited
suite **64/64 passed**; all **7 new initial regression cases failed** on main.
After implementation: initial complete checkpoint **74/74 passed**, then the
extended targeted HTTP/browser journeys **13/13 passed**. The final complete
runner and CI results are recorded in the PR delivery below/description.

Coverage added in `tests/project-qa-http.test.js`,
`tests/project-qa-browser.test.js`, and `tests/project-qa-migration.test.js`:
- Empty/completed project discovery via Plan and Work, refreshed and new signed-in
  browser contexts, plus another owner seeing no projects and rejected writes.
- Actual UI project creation, save, direct edit, confirmed delete, decomposition,
  move, completion and reload after real fixture-server restart.
- Exact 60 → 40 → 55 totals, child-estimate replacement semantics after a 15-minute
  grandchild (25, not 70), all ancestors, emptied parents, fractional integer-ms
  edits, unaffected unrelated tasks and undo.
- Four generations of task-to-container decomposition, stable IDs, retained own
  actual, completed subtree moves and no foreign-key violations.
- Batch rollback after partial attempted move, failed insertion/undo/group scope,
  cycles and foreign ownership; active interval mutation guards.
- New children reopen completed ancestors; completing one child leaves its
  sibling byte-for-byte unchanged and completed children editable.
- Persisted nullable deadline and pairwise ranks change independently of each
  other and duration; unestimated urgency is unspecified.
- CSV retains former-leaf own actual once, excludes deleted estimates, and keeps
  canonical IDs, statuses and units.
- A realistic v4 schema gains only the two columns/marker, preserving original
  field values, owners and data/reset markers; a second process restart is stable.

### Protection for the 17 passing manual scenarios

| Previously passing behavior | Automated protection |
| --- | --- |
| Five-task entry/sorting | Existing real-loader timed-list comparison tests and mixed parser/duplicate tests; new project part sorting unchanged. |
| Skip sorting keeps order | Existing fresh-list and selected/manual-order queue tests. |
| Mixed estimated/unestimated | Existing B1/B2/B3 journeys; new deferred project estimates through execution gate. |
| Insert during Work | Existing Focus add/blocker and integrated standalone insertion journeys (label selector updated only). |
| Expiry does not advance | Existing timer/late-hard-stop Focus checks. |
| Continue after expiry | Existing explicit boundary/resume behavior retained. |
| Exactly-once completion | Existing lost-response/immediate-Done journal tests, plus new sibling completion isolation. |
| Interrupt/resume without double-count | Existing interval retry/pause/background tests and new retained actual checks. |
| Refresh active Work | Existing paused recovery and uncertain-action reload tests. |
| Close/reopen tab | Existing background-boundary/server-only recovery fixtures; physical browser suspension remains manual. |
| Resume unfinished in order | Existing persisted work-session queue/rank recovery tests. |
| Another browser restores server data | Existing server-only recovery plus new fresh-context project discovery. |
| Persistent project relationships | Existing nested graph tests plus new recursive/move/server-restart journeys. |
| Sign out/in | Existing captured-account listener/token race tests and new same-owner fresh contexts; real Clerk sign-in remains manual. |
| Different-user isolation | Existing forged JWT/ownership tests plus new project discovery/mutation isolation. |
| Confirmed changes survive refresh | New exact estimate/completion/move journey and additive migration/restart tests. |
| Consistent export | Existing canonical CSV escaping/units tests plus retained own history/deleted-estimate summary regression. |

These are regression protections, not a claim that all 17 physical/manual cases
were rerun with live Clerk or actual mobile suspension. The full existing suite
continues to cover Focus request ordering, timers, ownership, retry and recovery.
`package.json` defines `test`, `start` and `dev`; there are no lint or build scripts.
The repository's QA runner additionally syntax-checks JavaScript and checks diff
whitespace. Browser fixtures use the real HTTP/SQLite backend with offline signed
RSA Clerk tokens and a simulated browser SDK, not real account credentials.

## Local and manual QA

Use Node 22.23.3 (`nvm install && nvm use`), then in the repair checkout:

```bash
npm ci
bash scripts/qa-integrated-beta.sh setup
bash scripts/qa-integrated-beta.sh test
bash scripts/qa-integrated-beta.sh serve --port 3002 --env-file /absolute/private/dev-clerk.env
```

`setup` installs the matched Playwright Chromium and runs verification. Use a
private **development** Clerk environment file for authenticated project QA;
guest cannot manage server projects. The runner isolates SQLite under its QA root;
never use production task data. See `INTEGRATED_BETA_LOCAL_QA.md` for environment
setup. In this executor the browser download returns HTTP403 Domain forbidden:
`cdn.playwright.dev` and `playwright.download.prss.microsoft.com` need adding to
the Codex environment domain allowlist (`network_policy.allowed_hosts`). Diagnostic
local verification uses `CHROMIUM_PATH=/usr/bin/chromium` (154.0.8037.57). CI installs
the lockfile-matched Chromium 141/build1194; results are reported independently.
No credential changes or Docker steps are needed.

1. Sign into development account A. Plan → Create project without a container
   estimate. Enter Ten 10m, Twenty 20m, Thirty 30m; keep order and save. Confirm 60m.
   Refresh, Work → Resume → project → Manage; find the same IDs. Plan → Existing
   → Edit must show the same records. Repeat after sign-out/in and another browser.
2. Edit the root: delete Twenty, confirm **Delete Task**, expect 40m. Edit Thirty to
   45m, expect 55m. Reopen fields without changes; save again, including a fractional
   minute estimate, and confirm no estimate drift or sibling edits.
3. Edit Thirty → Add subtask → Fifteen 15m. Choose position; either keep the new
   child whole or decompose further. Thirty becomes a container with the **same ID**:
   its 45m estimate is replaced by its child's 15m, so root is 10+15=25m. Repeat
   through several levels. Recorded actual stays as retained own history.
4. Use Add estimate later for a new child (or Add estimates later during project
   creation). It saves and can be renamed without an estimate. Focus must request
   an estimate before opening a timed interval; urgency stays Unspecified meanwhile.
5. Move Thirty and its descendants to a second project. Source becomes 10m,
   destination 15m. Confirm node IDs, status, estimates and actual time stay intact.
   Try moving into itself/descendants or another account: fail without partial edits.
   Group, ungroup, multi-select move, delete a subtree, and Undo; inspect both sides.
6. Complete Fifteen from its parent editor. It remains visible as completed;
   containers auto-complete only when no open descendants remain. Unrelated Ten
   stays pending. Reopen/add a child: ancestors reopen, siblings remain unchanged.
   Refresh and restart the local server; verify estimates/progress/status again.
7. A project with all children completed and a newly created empty project must
   remain discoverable in Plan and Resume. Start is unavailable when no unfinished
   work exists; Manage remains available. Account B must see neither project.
8. Pairwise importance ranking: compare tasks, save/reload. Change only a deadline,
   then duration, then re-sort; each operation preserves the other inputs. Missing
   deadline or estimate is explicit. No third priority input is requested. Work
   position is an explicit queue placement; it does not invent an importance score.
9. Re-run the original 17 passing scenarios, including actual timer/audio output,
   live Clerk sign-out/in, background/close-reopen and safe cross-browser data.
   Export hierarchy metrics; leaf summary counts history once, not project totals
   plus descendants. Use an approved test account if checking hosted environments.

## Remaining decisions, operational limits and risks

- Existing nonempty parent-estimate semantics are clear and preserved: children
  replace the own estimate. Deleting/moving the last child leaves a derived zero.
  A never-decomposed empty project keeps its optional manual estimate. Whether a
  future product should restore an old parent estimate after decomposition is
  undone, or let a completed project keep runnable own work, is not inferred here.
- Existing empty-project intent cannot be recovered from historical cached totals.
  Migration preserves them; future child mutations establish derived mode. Actual
  time lost by older conversions cannot be reconstructed without an approved
  reconciliation/backfill policy (D4 remains unchanged).
- Completed estimates stay in planned totals; deleted/cancelled estimates are
  excluded, while acknowledged deleted actual remains history. Cancellation and
  arbitrary multiple prerequisites retain their existing product-policy limits.
- A decomposed node retains its priority/deadline record, but the existing optional
  ranking scope remains open independently actionable leaves. No parent-importance
  or deadline inheritance, optimizer, or weighting policy is introduced. Queue and
  hierarchy positions are user execution/structural intent, not a third score.
- Destructive edits/completion/decomposition of a currently timed leaf/subtree
  require Pause/Stop first. This prevents abandoned intervals and does not alter
  direct name/estimate edits. Undo refuses stale decomposition/type changes rather
  than overwriting a newer graph or another account's data.
- Real Clerk, physical mobile/background behavior, actual speaker output and
  hosted deployment/readback cannot be established by the offline fixtures.
  The known dev/production Railway mapping and mobile-auth compatibility spec on
  main are separate operational work; no host/credential changes are made here.
- Frontend and backend need deploying together after review because the shared
  editor now uses the transactional batch API and schema 5. This PR is **not merged
  or deployed automatically**, per this task's explicit release instruction.

Additional timing inspection: the project toolbar formerly used wall time since
project selection as elapsed, including pauses/navigation, then subtracted it
from a cached estimate. It now reads canonical planned/acknowledged actual and
backend remaining work, labels them **saved**, and never creates a second project
clock. The task timer keeps running independently. The read waits only for an
already-pending journal, so it cannot occupy an empty journal and strand the next
recovery save. The inherited stale-estimate/recovery regression exercises this.
Existing empty containers' acknowledged actual is carried forward when they first
receive children rather than being overwritten by the new child's zero.

One full checkpoint had an inherited sorting-reload timeout; that same test passed
in isolation. A later verification exposed and fixed the toolbar's empty-journal
integration issue. No failing tests were disabled, no timeouts were raised, and
no timing/ordering assertions were removed. The final clean full run is the
acceptance evidence; earlier failures are not presented as successful checks.
