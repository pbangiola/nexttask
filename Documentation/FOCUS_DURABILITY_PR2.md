# PR 2: durable Focus sessions, actions and recovery

## Branch and source

Foundation: `codex/graph-foundation` at `e280df37072e2b8bb34767bdb58ed1d36bb808c8`.
Current main was fetched at `c151de51f52450025e1f0a4b32e0980dac9c1f5e`; it contains the
review/specification but not the foundation. The missing foundation draft is
[#73](https://github.com/pbangiola/nexttask/pull/73). This integration branch is
`codex/focus-durability`, based on the foundation and targeting it as a stacked
PR. Neither branch was merged or deployed.

The implementation follows
[the reviewed durability specification](https://github.com/pbangiola/nexttask/blob/c151de51f52450025e1f0a4b32e0980dac9c1f5e/Documentation/CODEX_NEXT_FOCUS_DURABILITY_SPEC.md).
It reuses the foundation's owned session/queue/interval APIs and public asset
allowlist, plus the existing main task entry, merge sorting, estimate, planner,
clock and audio concepts. The best-effort timing bridge was changed to reject
failures. No old feature branch or bulk-project bootstrap was copied wholesale.

## Behavior

- One authenticated graph client is loaded before its timing/controller
  consumers. Updated asset versions include the outer auth URL. Application
  controls are revealed only after scripts and initialization are ready.
- New lists, imports, existing backlog, projects and optionally sorted saved
  work enter the same preparation path. Stable canonical rows are saved first;
  only pending/active independently actionable task IDs enter the ranked queue.
  Project containers, blocked rows, cancellations and completed history stay
  out of executable replacement. Synthetic Sort Tasks history is saved and
  completed, including interrupted sorting, without queuing completed overhead.
- `POST /api/work-sessions/prepare` validates and creates the session and queue,
  then ends a replaced session in one SQLite transaction. Queue failure rolls
  back creation and leaves the old session recoverable. Canonical rows already
  saved in preparation remain available; they are not deleted on queue failure.
  A definitive validation failure offers Return to Saved Work only after an
  owned lookup confirms the candidate session was never created. Uncertain
  network responses require retry of the same session ID.
- A per-account browser write-ahead journal serializes complete HTTP action
  plans and immutable snapshots. IDs, captured timestamps, acknowledged steps
  and interval mappings survive reload. An immediate Done waits for start
  acknowledgement, stops at the captured click time, saves completion, replaces
  eligible queue items, then enters the next task. Stop paths resolve against
  the acknowledged interval ID even when the backend reused an existing run.
- Failed saves remain pending and have an explicit retry action. Duplicate
  transitions are prevented while an action is outstanding. Focus can display
  an optimistic clock after preparation, alongside the pending start state;
  completion and navigation are not reported as durable until acknowledged.
- Add and blocker actions persist rows before queue references. Existing single
  blocker relationships survive recovery; completing the prerequisite unblocks
  its dependent. Multiple-prerequisite behavior remains outside scope.
- Interruption closes the interval and pauses browser time. Stop Working pauses
  before its checklist; confirmation saves selected completions and ends the
  session. Natural completion and Start Over finish relevant writes and close
  the session. These actions preserve task data. Late hard-stop detection and
  expired recovery stop intervals at the recorded deadline before session end;
  the backend's ending fallback also accepts that captured boundary.
- Recovery validates cached session closure before replaying pending actions.
  Confirmed server closure cancels stale local transitions with an explicit
  notice, and terminal canonical rows cannot be reopened or have their totals
  overwritten by Focus snapshots. Open-session recovery loads ranked queue,
  current owned graph, interval-backed history and blocked dependents. Project
  labels/context are derived from canonical parents; names, ownership, session
  assignment and sibling positions are preserved. With browser storage deleted,
  acknowledged server work still recovers paused with an explicit Get to Work.
- Identity is pinned to the Clerk account and authentication session captured
  at bootstrap, checked before/after token retrieval and responses. Switching
  accounts aborts outstanding requests, stops local clocks and hides old UI.
  Journals, snapshots and planner UI state are scoped to their creating account.
  An already committed request belongs to its original account; it is not
  reauthenticated or replayed as the replacement account.

## D4 separation and lifecycle limits

D4 remains unapproved. Intervals record lifecycle boundaries; their sums do not
replace or add to canonical `elapsed_ms`. Browser clocks and acknowledged elapsed
snapshots retain their existing authority and display formatting. Recovery uses
canonical saved elapsed totals, pauses, and requires explicit resumption. It
does not infer unrecorded historical work or claim reconciled cross-device time.

Visibility/pagehide interruptions synchronously journal a captured pause and
attempt its writes. If an OS kills the page before either event runs, recovery
can only close an open interval at discovery (or the expired hard stop). It does
not infer how much of that gap was actual work. Clearing browser storage can
remove unacknowledged local intent; server-only recovery preserves acknowledged
server state. Device behavior and elapsed reconciliation need separate review.

## Validation actually run

Runtime: Node **22.23.3**, matching `.nvmrc`, with pinned better-sqlite3 11.10.0.
A clean `npm ci` completed with the updated lockfile and Playwright development
dependency. Writable temporary npm/native-build caches were used in the managed
executor. Chromium was the installed `/usr/bin/chromium`.

Final validation: **44 tests passed, 0 failed, 0 skipped**, including all 24
foundation tests and 18 Chromium browser/HTTP integration scenarios plus two
additional HTTP regressions. Syntax checks passed on **34 JavaScript files**
(tracked and newly added), and `git diff --check` passed. All fixtures use disposable SQLite files and same-origin loopback
HTTP; no production task writes are used.

The browser suite runs the real HTML/auth/application loader and actual HTTP
APIs in Chromium, with controllable request/response delay and response loss.
Its Clerk SDK bootstrap is simulated; API requests carry locally signed RSA
fixture JWTs verified by actual Clerk middleware. Audio pulse scheduling is
instrumented; actual speaker playback is not claimed.

| Check | Evidence |
| --- | --- |
| Foundation regressions | All original 24 integrity/store/timing/HTTP/restart/upgrade tests retained |
| Fresh estimated lists, skip/sort | Canonical rows, completed sorting history, ordered queue and Focus interval; one bootstrap/planner loader |
| Delayed start + immediate Done | HTTP ordering, captured stop boundary, one interval; acknowledged existing-run IDs also handled |
| Lost start/stop responses | Stable IDs, same stop boundary, final completion; reload with pending immediate Done |
| Snapshot ordering | Delayed first response prevents second dispatch; final stored elapsed state is newest |
| Replacement failure | Old open session remains discoverable; no empty new session; same-ID retry |
| Safe failure fallback | Candidate absence confirmed; old session recovered; new canonical rows retained |
| Nested project and blocker | Canonical parent/name/session/position retained; blocked row excluded; storage-free recovery preserves relationship |
| Sorted saved backlog | Queue rank changes while canonical IDs, estimates, names and sibling positions remain intact |
| Add, checklist, natural finish | Row exists before queue use; selected completions saved; ended session with no open interval |
| Late/expired hard stop | Interval and session end at recorded deadline, including server-only recovery; no interval-derived elapsed mutation |
| Browser storage/backend restart | Queue recovered paused after a real backend process restart, without extra sessions/intervals |
| Stale cache/journal | Completed/ended server state retained; confirmed closed session cancels stale pending start |
| Discovery failure | Explicit retry; existing recoverable work preserved without an empty replacement |
| Account switch during token wait | Old write is not dispatched; no other-account row created or mutated |
| Interrupted sorting reload | Canonical task IDs retained; overhead completed with acknowledged elapsed and never queued |
| Background/resume | Captured pause, explicit resume, exactly one new run and no repeated instrumented deadline cue |

No required automated check remains failing. Real Clerk browser sign-in,
physical mobile suspension/resumption, actual audio playback and deployment
were **not run**. The signed-token browser/HTTP fixtures do not substitute for
those checks. No Clerk credentials or environment network policy were changed.

To reproduce:

```sh
# Use Node 22.23.3 (for example, nvm use).
npm ci
# Use installed Chromium; otherwise install Playwright's Chromium first.
CHROMIUM_PATH=/usr/bin/chromium npm test
git ls-files -z '*.js' | xargs -0 -n1 node --check
git diff --check
```

In a restricted executor, put npm's cache and `npm_config_devdir`/
`XDG_CACHE_HOME` under writable `/tmp` directories. Network commands require
execution network permission; the configured package-host policy was sufficient.

## Compatibility and data preservation

Main's canonical planner implementation is retained; its only code change is an
account-specific UI cache key. The estimate parser and merge-sort algorithm are
retained. `frontend/deadline-audio.js` is unchanged, loaded once and checked for
cue reuse after pause/resume. Local API routing and explicit public asset denial
remain covered by foundation HTTP tests, extended to the new scripts.

Schema version 3 and its additive migrations are unchanged. No reset, DROP,
permanent deletion or elapsed backfill was added. The original upgrade tests
retain legacy rows with and without migration markers through restart. New
preparation/history APIs use the existing durable tables. Existing canonical
structure protections remain in place; terminal snapshot protection is stricter.
Planner edits remain the explicit path for changing canonical structure/state.
