# PR 1: durable graph foundation

This change implements PR 1 of CODEX_FEATURE_INTEGRATION_SPEC.md on main
`2fea12c0d1b590f719811fac5a691f0e7443dbda`. Feature rows in scope: 2, 4, 5,
8, 9, 10, 11, 14, 15, 20, 21, 34. These rows describe foundation coverage;
they are not a claim that the later Focus UI or all spreadsheet features work.

## Source provenance

Rechecked all audited refs during implementation; none changed:

| Branch | Head |
| --- | --- |
| task-graph-rebuild | a590b42614a633169f4cdf38cf37bb2fb186598c |
| sso | 32e325f66530500780078bdfd68d3da58d25f55a |
| Ssoplusmvp | 9890d4ad783851aeef1544113605ec822d66b388 |
| Eisenhower | 746ee9df7dc6edb3b3c664f8e0469a834a767109 |
| MVP | 4df391a15e63b4c50f141d71f765c3371646645a |

Selectively reused graph task-graph-store.js, task-graph-routes.js, the
snapshot/ownership concepts from database.js and user-store.js, all four
source graph test files, and the isolated task-graph-timing.js bridge required
by the source timing tests. The broken literal-backslash-n import method was
rewritten as a valid read-only view on main. No whole-branch merge was used.
Main's tree-integrity.js, planner loader, estimates and audio are retained.

## Behavior and boundaries

- Owned work sessions, independently ranked queue items and interval history
  are persisted in SQLite. Session endings close their running intervals;
  retries do not reopen ended sessions or replace closed interval timestamps.
- Legacy Focus snapshots cannot rename, flatten, move, retype, reorder or
  transfer existing canonical nodes. Project snapshots do not overwrite
  container state. Planner CRUD remains the place to edit the graph.
- Foreign and anonymous IDs fail rather than becoming owned by the caller.
  Queue replacement and snapshot writes roll back atomically on invalid IDs.
  Resume/import returns an owned view without relocating tasks.
- New interval starts require a pending/active actionable task. A supplied
  work session must be owned, open, and contain that task in its queue.
  Already acknowledged interval-ID retries are read-only. Prerequisite-edge
  semantics are deferred to PR 4 and D2.
- Public files are enumerated explicitly: index and intended frontend scripts.
  Backend files, databases, sidecars, Git metadata and unknown paths are never
  mounted. Health/config precede authentication; protected APIs require Clerk.
  Missing publishable configuration keeps the existing explicit config error.
- On loopback hosts both frontend API constants use the local origin, keeping
  development task mutations away from production. Hosted routing is unchanged.

The timing bridge is included for its regression tests but is **not loaded**
by the UI in this PR. Browser work-session creation, lifecycle wiring and
recovery are PR 2. Interval records do not update canonical elapsed_ms or
choose between server intervals and browser clocks (D4). Main's current
project rollups and empty-project behavior are preserved; D7 is still open.
No guest import, erasure, decomposition, prerequisite, ranking or scheduling
proposal has been adopted. D1–D8 remain pending where the spec marks them pending.

## Reproducible development and validation

Use Node 22.23.3 (`.nvmrc`) and `npm ci`; better-sqlite3 is pinned to 11.10.0
and package-lock.json fixes the dependency graph. Node 24 is outside the
supported engine range for this native dependency. The test suite creates
only disposable local databases and disables Clerk telemetry in its HTTP test.
HTTP authentication tests generate an offline RSA key and pass it to Clerk's
actual middleware, verifying valid and forged JWTs without a live Clerk account.

Run:

```sh
npm ci
npm test
# Syntax-check all tracked JS, plus any new files before staging.
git ls-files -z '*.js' | xargs -0 -n1 node --check
# Run the backend with a separate development data directory and configured
# CLERK_PUBLISHABLE_KEY and CLERK_SECRET_KEY; .env is not auto-loaded.
mkdir -p /tmp/nexttask-dev-data
RAILWAY_VOLUME_MOUNT_PATH=/tmp/nexttask-dev-data npm start
```

Checks cover the source integrity/store/timing/process-restart suite, nested
project snapshots and existing main rollups, cross-user and anonymous rejection,
atomic queue replacement, retry semantics, public/private HTTP behavior, static
path denial, loopback routing and upgrade/restart preservation. Authenticated
HTTP requests are exercised locally; real Clerk browser sign-in, mobile
suspension and production deployment are not verified by these tests.

## Migration and rollback

Schema version 3 adds work_sessions, work_session_items and work_intervals with
indexes and foreign keys. It does not rewrite canonical IDs, hierarchy, names,
positions, estimates, ownership, existing sessions or data-migration markers.
Older task schemas gain the previously supported graph columns additively.

The legacy fresh-start deletion and unconditional DROP of completed_tasks and
task_queue have been retired. Pre-Clerk databases without a reset marker retain
all data and remain without that marker; anonymous rows stay anonymous. A
populated incompatible users schema still fails explicitly rather than deleting
its data. Attribution/conversion of such historical data is separate work.

Back up the database before deployment. Retain the added tables if reverting
application code so durable records remain available. **Do not roll back an
unmarked pre-Clerk database to the old reset-bearing startup:** that code would
delete existing data. Use a backup and a reset-free rollback build. No production
database or original branch was modified by this implementation.
