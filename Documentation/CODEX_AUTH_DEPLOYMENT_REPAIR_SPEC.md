# Codex repair: deployed API mismatch and overlapping mobile sign-in
Reported 2026-10-14 morning, America/Chicago.
Reviewed main: 9ccfe43 (integrated beta PR #76).
Screenshots: IMG_1286 and IMG_1287, inspected from the conversation. Images need not exist in Codex's workspace.

## Evidence actually verified
- Hosted Pages index loads frontend/auth.js?v=20261014-beta-1 and the integrated beta input/UI.
- GET https://nexttask-production.up.railway.app/api/health returned HTTP200 with version recursive-task-tree-v1 and only legacy capabilities.
- Reviewed main backend/server.js declares nexttask-integrated-beta-1 and advertises durable-work-sessions, ranked-session-items and work-interval-history.
- Production /api/config returns a Clerk test publishable key, matching the screenshot's Development mode badge. This does not establish invalid credentials and does not authorize changing them.
- No private user data was fetched or production data written in this review.
- Screenshots show sign-in and active guest time-limit workflow simultaneously, then signed-in recovery failure with Retry Recovery and Retry Save.

## Objective
Correct auth/guest presentation, detect incompatible deployments before recovery/writes, and provide a concrete Railway deployment/readback checklist. Preserve all local journals, guest lists, canonical data and Clerk identity.

Implement on a new branch from current main; recheck evidence because deployment may have changed. Open one tested draft PR. No automatic deployment or credential changes are authorized by this spec.

## R1 — Fix bootstrap state ownership
frontend/auth.js currently:
1. mounts Clerk sign-in when signed out;
2. calls guest(), which loads/shows the app;
3. does not hide/unmount the sign-in form.
This directly explains the screenshot overlap; the 1500ms guest fallback creates another timing path requiring tests.

Implement explicit bootstrap/presentation states:
- loading;
- guest ready;
- sign-in requested;
- authenticated ready;
- account changed/error.
Guest-ready startup must not automatically show the full Clerk form above the workflow. Keep an accessible Sign In entry.
When sign-in is explicitly requested, mount one form in a dedicated screen or dismissible modal. Suspend/hide the guest workflow's active presentation, without clearing its list or silently uploading it.
Cancel returns to guest state; success initializes authenticated state exactly once and hides/unmounts the obsolete form. Preserve the existing explicit no-guest-upload policy.
Late Clerk/config responses after guest fallback cannot mount a stale sign-in form or double-load the application.
Account changes continue to invalidate pending requests; do not authenticate a guest/old-account journal as a new account.

Mobile acceptance:
- loading/guest/sign-in/authenticated each have one active main view;
- sign-in fits small viewport and scrolls without colliding with guest controls;
- user can dismiss sign-in and return to intact local list;
- slow config/SDK and network failure leave useful guest entry;
- one application initialization, one sign-in mount, no duplicate timers.
Use simulated SDK tests plus a clearly separated real Clerk/mobile checklist.

## R2 — Verify API compatibility before touching durable state
The deployed legacy backend cannot fulfill integrated-beta session/history/interval requests. Retry alone cannot correct absent server functionality.
Before authenticated recovery, validate health/API contract/capabilities, with a bounded request and meaningful failure state.
Required durable capabilities must be present before:
- validateRecovery;
- journal replay/flush;
- canonical snapshots;
- open-session discovery;
- queue/interval writes.
Distinguish unavailable network, incompatible API, unauthorized identity and task/session-not-found where observable.

Critical data safety:
TaskGraph.validateRecovery currently interprets a session lookup404 as confirmed closure and cancels stale local transitions. A404 from an old server lacking the entire route is not proof that the user's session ended.
Compatibility must be confirmed before an ID404 can trigger existing closure behavior.
An incompatible/unreachable backend must not delete journals, discard actions, replace saved sessions, reset browser state or submit empty snapshots.

UI:
- Explain that the backend needs updating when capabilities are missing.
- Offer one relevant Retry Connection/Recovery action; avoid competing Retry Save and Retry Recovery messages for the same startup failure.
- Keep pending-save retry distinct if there genuinely is an unresolved write.
- Preserve local guest use and pending authenticated work; do not offer destructive clearing as troubleshooting.
- Recovery retries remain safe/idempotent after the backend is updated.

Regression fixtures:
1. Legacy health success + missing graph routes → incompatibility message, no journal mutation/replay/private writes.
2. Network timeout/offline → retry state, data unchanged.
3. Compatible API + true missing/ended session → approved closed-session behavior.
4. Expired auth → sign-in/reconnect guidance, no cross-account replay.
5. Compatible server restored after initial failure → recovery succeeds with original stable action IDs.
6. Viewport/recovery failure → one clear actionable status, not duplicate generic retry panels.

## R3 — Prepare matched backend deployment
The immediate operational fix is to deploy the current compatible backend to the Railway service used by the frontend, preserving its data volume and current Clerk configuration.
Investigate the actual service source branch, repository root directory, deployed commit and latest build/start logs. Do not assume the main GitHub merge redeploys Railway.

Known repo configuration:
- root package.json; Node22.x and locked native SQLite dependency;
- npm start → backend/server.js;
- railway.toml uses npm start and /api/health;
- data persistence through RAILWAY_VOLUME_MOUNT_PATH.
Verify persistent volume and back up database before production migration. Use additive migrations; do not reuse retired reset-bearing startup.
Retain existing Clerk keys and allowed origins. Moving from test to live Clerk changes identity/configuration and is separate work.

Produce a deployment checklist with:
- exact compatible commit;
- source/root/start/runtime settings;
- volume backup/preservation;
- frontend/backend compatibility;
- rollback using a reset-free build;
- postdeployment readback.
Stage and validate before requesting final deployment authorization. If connector/runtime cannot access Railway, state that limit and give exact dashboard steps; do not claim deployment.

Readback gate:
- /api/health returns the compatible beta version/capabilities;
- unauthenticated private graph endpoints return auth rejection rather than legacy route absence;
- real signed-in browser recovers its saved state;
- new disposable QA work persists and resumes after a controlled backend restart in staging;
- Pages asset versions/build identity match tested code;
- physical mobile sign-in, dismissal and recovery checked where available.

## Build identity and diagnostics
Consider adding non-sensitive API-contract/build identifiers so the frontend can distinguish route incompatibility from missing records. Preserve backwards-safe public health/config behavior.
Diagnostics may show version, missing capabilities and HTTP status. Never display bearer tokens, secret keys, task contents or account identifiers in errors/logging artifacts.

## Out of scope
No automatic server redeploy, secret rotation, test-to-live Clerk conversion, deletion/backfill, auth bypass, broad anonymous attribution or elapsed-policy change.

## Deliverables
One draft PR with bootstrap fix, compatibility guard, regression tests, concise version notes and Documentation/DEPLOYMENT_COMPATIBILITY_QA.md.
Report independently verified results separately from SDK fixture results and manual/deployment checks not run.
Do not mark recovery fixed solely because tests use the new backend; test the old-backend mismatch explicitly.
