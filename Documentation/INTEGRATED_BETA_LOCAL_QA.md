# Integrated beta local QA (macOS and Linux)

Use a fresh QA database and development Clerk instance. Never point this runner
at production data. Guest QA requires no Clerk credentials. The runner preserves
local changes and never resets another checkout.

## Current checkout

Install/use Node 22.23.3 (with nvm: `nvm install && nvm use`), then:

```bash
git clone --branch codex/integrated-beta https://github.com/pbangiola/nexttask.git nexttask-beta
cd nexttask-beta
bash scripts/qa-integrated-beta.sh setup
bash scripts/qa-integrated-beta.sh status
bash scripts/qa-integrated-beta.sh serve --port 3002
```

After merge, clone `--branch main` instead. `setup` runs `npm ci`, installs the
Playwright-lockfile-matched Chromium and executes checks. Open
`http://localhost:3002`. Stop with Ctrl-C. Data/browser/logs are isolated under
`${NEXTTASK_QA_ROOT:-${TMPDIR:-/tmp}/nexttask-beta-qa}`. Tests use their own temporary
fixtures. Run `bash scripts/qa-integrated-beta.sh test` after local edits.
On Linux, missing browser system libraries may require the administrator to run
`node node_modules/playwright/cli.js install-deps chromium`.

Alternatively maintain an isolated clone using `setup --root /absolute/qa/path
--ref codex/integrated-beta`; use the same `--root` for test/serve/status. After
merge use a new root with `--ref main`. Existing roots are only fast-forwarded
when clean and on the requested branch. Old foundation/Focus QA scripts delegate
to this runner; they no longer clone deleted branch refs.

For authenticated QA, prepare a private development environment file with
`CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` from the **same development Clerk
instance**, then run:

```bash
bash scripts/qa-integrated-beta.sh serve --port 3002 --env-file /absolute/private/dev-clerk.env
```

Configure that Clerk instance for localhost as required by its dashboard. The
runner sets loopback CORS origins and its own isolated volume path. Never commit,
print, or copy production secrets. A public `/api/config` failure without a key
is expected in guest-only QA. Diagnose proxy domain denial before rotating keys.

## Combined acceptance journey

1. Start without keys/offline config. Continue as Guest, enter `Alpha, 5m, Beta`
   plus a duplicate Alpha line. Confirm distinct occurrences, timed Alpha retained,
   Beta missing-time prompt, and no private `/api/users/...` calls. Sort, supply
   Beta's estimate, start Work, reload: recovery is paused. Resume, Done, Stop.
   Guest reload retains its local list. Sign in explicitly: no guest auto-upload.
2. In the separate signed-in account, create a project without upfront estimates,
   add untimed parts, follow missing-estimate continuation, and sort. Add a nested
   project and a nested untimed task. Edit the task directly; confirm canonical
   ID and acknowledged actual time survive and parent totals change immediately.
3. In Work select that project; untimed eligible items request estimates before
   timing. Trigger blocker, provide the replacement estimate, resume/reload,
   complete, and Stop. Switch to an unrelated standalone task: no stale project
   toolbar. Return to Plan/Work editor repeatedly; Back goes to actual parent.
4. Add same-named tasks under different parents. Open Importance / urgency:
   context/IDs distinguish them; unset fields say Unspecified. Cancel a pairwise
   comparison and confirm ranks unchanged. Complete comparison, save a past due
   date, reload, check persistence and latest-start slack. Existing Work queue
   order and canonical hierarchy must not change. Thresholds are only proposals.
5. Open Hierarchy / metrics, expand nested projects, download CSV. Check quoted
   names, IDs/parent IDs, minute units and actual−estimate variance. Leaf summary
   must not add project rollups a second time. Retained history is included.

## B1–B8 Oars fixture

Create Oars with Left oar: 45, 60, 60, 15 minutes; Right oar: 90, 90 minutes.
Use repeated names to exercise identity. Expected totals: Left 180, Right 180,
Oars 360. Edit the 45-minute leaf to 30: Left 165, Oars 345 immediately. Move the
15-minute leaf from Left to Right: Left 150, Right 195, Oars still 345. Undo:
Left 165, Right 180, Oars 345. Group and ungroup by explicit IDs; totals and
elapsed survive. Test the same editor via Plan and active Work ancestry. Timed
parts keep their prefilled estimates; untimed parts ask once before execution.
Navigate Back, return to entry, and start an unrelated task: no stale editor,
buttons, timer, or literal backslash-n text.

## Durability, isolation and manual platform checks

With development data only, simulate offline/delayed responses around start,
Done, Stop and replace. UI must not falsely advance before acknowledgment;
retry must not duplicate interval/elapsed. Reload while pending and while running:
recover safely paused. Switch accounts while requests are delayed; another
account's tasks/session must not appear. Hard stop and browser close must not
invent background elapsed. A blocked-only project must explain why it cannot
start and keep its prerequisite links, rather than create an empty run.

Run on a physical narrow mobile screen/touch device; check entry, comparisons,
project editor, missing-time prompt, optional table, metrics, and reload. Verify
actual alarm sound with browser permission/foreground/background restrictions.
Use live development Clerk sign-in/sign-out and inspect ownership rejection.
These physical/live checks remain manual, not claimed by simulated SDK/offline
signed-token tests.

## Network and production verification

If Chromium download returns `403 Domain forbidden`, keep Codex **Agent internet access** enabled and extend the environment
**domain allowlist** (`network_policy.allowed_hosts`) to include `cdn.playwright.dev` and
`playwright.download.prss.microsoft.com`, then rerun setup. Allow `api.github.com`
for shell API checks, and production backend/frontend domains for readback.
Do not disable the managed proxy or change Clerk keys based on that error.
`CHROMIUM_PATH=/usr/bin/chromium bash scripts/qa-integrated-beta.sh test` is an
explicit diagnostic fallback; it does not establish matched-browser compatibility.
GitHub Actions supplies the matched-browser verification gate.

After an authorized main deployment, confirm `/api/health` reports
`nexttask-integrated-beta-1`, new shared assets load, guest makes no private calls,
and development/safe test-account auth works. Verify persistent Railway volume
and data survive a controlled restart using an approved test account. Record
backend and frontend separately; a successful merge is not deployment evidence.
