# Consolidated implementation — local delivery

Date: 2026-11-02. The original integrated change was committed and pushed as 5c11b8c. The user subsequently authorized implementing the reported feedback and pushing one follow-up commit to `codex/plan-vnext`. Main remains unchanged.

## Repository reconnaissance

The live GitHub branch listing contains only `main` (`f21d470f5144a8bdf7ad20b6c19997bdabe453db`) and `codex/plan-vnext` (`ef0f19a8575e7c96acdf367be8e6c15be5091ea1`). Local tracking refs for the old branches are stale. Archived tags under `archive/vnext-20261028/` preserve sso, Ssoplusmvp, MVP, Eisenhower, task-graph-rebuild and the old integration/security branches. `ssovmvp` is not an active branch. No branch refs were changed during this run.

The current implementation source is the experimental branch, which contains main's repaired Clerk authentication, SQLite task graph, durable Work sessions, journal, interval history and legacy project editor, plus the newer Plan scheduler, bulk editing/deletion and weekly working hours. Historical divergence is documented in BRANCH_AUDIT_CODEX_HANDOFF.md and PLAN.md. Uploaded code snapshots were not used to replace current files.

The prior session established `codex/plan-vnext` as the Railway Dev branch and main as the production foundation. There is no Railway account connector in this session to independently verify the current service branch configuration. No live deployment was modified.

## Changes

- Welcome uses the exact copy in the consolidated request and exactly two prominent navigation choices. Get Started offers anonymous entry and existing Clerk sign-in. Anonymous entry works even when auth configuration is unavailable; no automatic sign-in form or guest startup gate.
- Anonymous and account data remain separate. Sign-in and browser Back retain local data and drafts. No implicit merge or overwrite.
- Shared black/white/gray visual tokens, rounded controls, keyboard focus, responsive layouts and blue native task/project hyperlinks.
- Plan views, task editors, Work project selection, entry and dashboards use browser history routes. Plan detail deep links and refresh restore their context; entry and edit drafts are owner-scoped. History does not override recovery errors, completion, or expired hardstop screens. Focus is paused when navigating away through history.
- Plan comparisons operate independently within each sibling group. Root projects retain their subtrees in inferred order. The server rejects cross-parent ranking writes. Legacy cross-parent comparison records are preserved but ignored in inference. Moving a task invalidates comparisons against former siblings in inference.
- Plan saves each comparison and its local insertion cursor. New components are inserted into an already compared sibling set. Work sorting retains answered comparisons locally and offers Resume importance sorting after interruption. A completed sorting session clears its draft so a deliberate re-sort can ask fresh questions.
- New Plan project components require duration and hard deadline, including batch capture. The public Plan creation API validates the requirement before writing any batch item. Existing imported/legacy untimed records are retained, and legacy APIs remain compatible. Project creation with one component needs no pairwise question; two or more prompt for relative placement.
- Completion and ranking stay separate. Backlog replaces the Inbox label and separates compared unfinished work from unsorted pending work. “Compared” means saved importance evidence, not that every possible pair has been answered. Execution sequence remains independently derived.
- Task hyperlinks open editors without adjacent redundant Edit buttons. Selection resets through Select all visible; no redundant Clear action. Archive remains available inside an editor as hiding from active views, with historical archived records retained. Delete remains explicit, confirmed and restorable.
- Work Resume filters out completed projects; legacy project management and the new Plan Completed view retain history. Canonical estimates, identities and hierarchy persist through editing and execution.
- Compatible lockfile updates: body-parser 1.20.8 → 1.20.9; qs 6.16.0 → 6.16.2. No major runtime/dependency upgrades.

## Preserved behavior and decisions

The existing schedule defaults earliest availability to now, respects weekly working hours and dated windows, keeps prerequisite enablement distinct from parent composition, explains placements/conflicts, and preserves importance when deadlines alter execution sequence. Its accessible calendar is a day/segment timeline, not an optimal global schedule solver. Reserve and incomplete information keep forecasts provisional. The matrix remains an explanatory projection of importance and remaining time freedom.

Hardstops save and pause the session at the recorded boundary; they never complete its tasks. Estimate alarms leave work running past zero. Snooze/dismiss affect notifications only. Browser audio remains subject to autoplay/background restrictions. Existing wall-clock timing, journal replay, interval identity and account-change protections remain in place.

The existing cross-device policy retains canonical server state and owner-scoped immutable request replay, accepts the first committed interval stop idempotently, prevents concurrent open actionable intervals, and pauses discovered work for explicit resumption. Browser wall-clock timestamps remain the timing authority; automatic clock-skew correction between devices is not implemented. Tests cover restart, duplicate stop, stale state, uncertain writes and recovery; they do not certify real-device sleep or locked-screen audio delivery.

## Data compatibility

No new schema migration, destructive rebuild, table drop, data reset or production database write is needed by this change set. Existing additive migrations remain in place. Comparison/draft state adds owner-scoped browser keys; original comparison history remains intact. No anonymous-to-account data merge is attempted. Reverting the code does not require reverting a database schema.

## Source content and remaining limits

The three original content sources are preserved in `Documentation/content/` with trailing whitespace normalized. Following the user's feedback, `scripts/build-learn-more.js` converts the Learn More source directly to static HTML. Its prose, headings, examples, original spelling and unfinished Hardstops sentence are retained. There are no added captions, editorial explanations, feature labels, or text alternatives visible in the article. Diagram images retain minimal accessibility labels and keyboard-scrollable regions.

The original Gantt cannot render literally because it contains circular dependencies, an undefined predecessor and unsupported `until` syntax. The renderable `.mmd` preserves the original tasks, fixed appointments and stated durations on Oct 25–26. The actual-work block is after lunch/email and before the late managing-up/transport boundary; the extra morning block and added chart title were removed. The flowchart uses the source's “this task”, “that task”, “or”, and “Next Task” labels. These technical encoding repairs are documented here, without explanatory text added to the article.

Diagrams are generated locally using Mermaid 12.2.0 and served as static SVG images through the explicit public asset allowlist. No Mermaid runtime, CDN, or additional production dependency is needed. Run `node scripts/build-learn-more.js` after changing the article source. All diagram sources are in `frontend/diagrams/`.

To regenerate after editing `.mmd` sources, use Node 22.23.4 and the existing Playwright development dependency. Download Mermaid 12.2.0 into a temporary directory (`npm pack mermaid@12.2.0 --pack-destination /tmp`), extract `package/dist/mermaid.min.js` from the tarball there, and run `MERMAID_BUNDLE=/tmp/<extracted-directory>/package/dist/mermaid.min.js CHROMIUM_PATH=/usr/bin/chromium node scripts/render-learn-more.js`. Omit `CHROMIUM_PATH` when using the matching Playwright-installed browser. Commit the regenerated SVGs along with the sources only when committing is authorized.

Routines remain future scope. The existing limited N-day recurrence feature is preserved; no full routines engine was added. Partial comparison drafts are local to a browser; cross-device continuation of an in-progress sorting cursor is not implemented, although completed and Plan per-choice comparison evidence is server-persisted. Legacy project management remains accessible for compatibility; the new navigation/design work concentrates on the active Plan and shared Work paths. Real mobile gesture/lock behavior and live Clerk/Google OAuth require device/account validation beyond mocked browser tests.

## Validation and artifacts

After the deployment-feedback fixes, the full regression run passed 142/142 tests with zero failures and zero skips. The completed article also passed a final focused browser check after diagram regeneration. Coverage includes all three local SVGs, source examples and six-tool matrix, exact source prose with no added captions, no external article resources, browser Back/Forward, mobile overflow, keyboard horizontal scrolling and Get Started navigation. Tests run with Node 22.23.4 and Chromium, disposable SQLite databases, authenticated API fixtures and an offline anonymous fixture. Existing migration, ownership, timer, blocker, journal and Work regressions are included. Screenshot artifacts are in `/workspace/work/consolidated-screenshots/`. Production dependency audit after the narrow parser updates reports zero vulnerabilities.

## Railway Dev setup

The user authorized pushing these feedback fixes to the existing `codex/plan-vnext` branch, which may trigger Railway Dev auto-deployment. Use the existing Dev service and its branch configuration. Keep main unchanged. Follow RAILWAY_SETUP.md: Node 22.23.4, `npm ci`, `npm start`, health `/api/health`, one replica and the existing isolated Dev volume at `/data`. Reuse the matching existing Clerk development publishable/secret key pair. `FRONTEND_ORIGINS` is the Dev HTTPS origin without a trailing slash. Do not enable `NEXTTASK_LOCAL_DEMO` on Railway. No new environment variables, schema reset, volume replacement or data wipe is required. After an authorized redeployment, refresh the frontend and exercise welcome, anonymous entry, sign-in, project capture, sibling sorting and Work resumption.


## Follow-up fixes from deployment feedback

- Learn More uses the user's original prose, with no added captions or amplifications. The build script makes source fidelity reproducible.
- Inspection/metrics buttons are no longer inserted into Work's landing page, including anonymous startup. Existing inspection functions and Plan's Matrix remain available in their existing contexts.
- Sign-in has its own history state and hides surrounding onboarding/app text while Clerk is open. Back restores the preceding view and anonymous draft.
- The legacy Project Editor's Add Task and Add Subtask now use the same required duration/deadline form as Plan. New sibling comparisons cannot be dismissed with Escape; a single child requires no comparison. The original editor context and nested parent are retained after saving. No existing untimed data is rewritten.
- Calendar uses forecast segment/start times only. Tasks without a planned placement are unscheduled; a deadline remains task metadata rather than a fabricated start.
- Frontend asset versions are bumped for the changed entry points.

Follow-up validation: browser regressions cover exact-source prose, no inspection buttons in anonymous Work, isolated Clerk sign-in with Back/draft preservation, legacy Add Task duration/deadline validation and mandatory comparison, Calendar planned starts versus unscheduled deadlines, nested parent retention, and server-restart persistence. The complete suite passed before committing.
