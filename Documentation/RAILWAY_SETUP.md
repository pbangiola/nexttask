# Railway deployment setup — integrated beta

Use Node 22.23.4 (`.nvmrc`; engines >=22.23.4 <23), frozen `npm ci`, and
`npm start` (`node backend/server.js`). No Docker is required.

## October 2026 security update

Node 22.23.4 is the minimum patched Node 22 release for the October 21
TLS/Brotli fixes and eMudhra certificate compromise. `.nvmrc` pins that release;
`package.json` and the lockfile require `>=22.23.4 <23`. CI reads `.nvmrc`.
Advisory: https://render.com/docs/advisory-emudhra

Rebuild and redeploy every backend service from the patched commit; a repository
change alone does not update a running process. Check hosting-level Node version
overrides too. On Render, `NODE_VERSION` overrides `.node-version`, `.nvmrc`, and
`package.json`, in that order. Update any override to 22.23.4 (or a later Node 22
patch) before rebuilding. On Railway, confirm the selected runtime in build logs.
Preserve the existing persistent volume and secrets.

Verify `node --version` in the deployed service, then check `/api/health` and
sign-in/task synchronization. To verify certificate rejection, use the running
service's Node HTTP client against both test endpoints listed in the advisory;
each must fail with a certificate verification error. A proxy/network error is
inconclusive. This repository contains no PHP application or Docker image.

## Service configuration

The current frontend loader is `frontend/auth.js`, with application API setup in
`frontend/initialization.js`. GitHub Pages uses the existing backend fallback
`https://nexttask-production.up.railway.app`; same-origin backend hosting uses the
request origin. There is no `js/config.js` to edit. If changing the public service
URL, update both shared bootstrap/application fallback locations consistently.

Set `FRONTEND_ORIGINS=https://pbangiola.github.io` for Pages, or a comma-separated
list of additional explicit frontend origins. Configure `CLERK_PUBLISHABLE_KEY`
and `CLERK_SECRET_KEY` from the same intended Clerk instance through Railway's
private variables. Never commit secrets. Proxy/domain-denial failures are not
evidence these credentials are invalid.

Mount persistent storage and set/confirm `RAILWAY_VOLUME_MOUNT_PATH`. SQLite
`task_sorter.db` is stored there. Preserve this volume across deploys. The beta
adds the owned task-priority table/schema marker without resetting task rows,
owners, acknowledged elapsed, or existing migration markers. Back up production
storage before operational changes using the deployment platform's supported
procedure.

Link the backend service to the repository's `main` branch with automatic deploy
if that is the selected release policy. A main merge only triggers deployment
when this integration is actually configured. Without Railway access, do not
claim that the backend deployed.

Verify `https://nexttask-production.up.railway.app/api/health` reports `ok: true`
and `version: nexttask-integrated-beta-1`; confirm deploy logs and volume mount.
Serve the frontend through GitHub Pages with the **whole current frontend/**
directory plus root index/styles/audio assets, or through the backend's explicit
public-asset allowlist. New required scripts: `task-entry.js`, `guest-graph.js`,
`beta-insights.js`; the loader owns ordering and cache version
`20261014-beta-1`. Never publish backend/database/config/secret files as static
assets. Confirm Pages and backend separately, then run the local/manual workflow
checklist in `INTEGRATED_BETA_LOCAL_QA.md` against safe test data.
