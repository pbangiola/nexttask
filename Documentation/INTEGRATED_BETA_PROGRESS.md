# Integrated beta progress

Base: main 5954d26. Recovered PR #74 head 617f7fb through refs/pull/74/head,
verified ancestry to e280df3; cherry-picked a676408 (Focus), d201773 (B1–B8)
and 8d05f13 (repair evidence). Main's QA scripts/docs retained for repair.
Recovered baseline: 55 tests passed, no failures/skips, Node 22.23.3.

Live sources inspected: sso 32e325f (duplicate shared foundation), Ssoplusmvp
9890d4a (structured entry/guest concepts), task-graph-rebuild a590b42 and
optional estimate commits e73c4f5/82b59b1 (already covered by recovered QA),
Eisenhower 746ee9d (pairwise ordinal ranking and latest-start slack), MVP
4df391a (local entry and estimate/actual/variance CSV concepts).
No wholesale merge; original live branches are preserved.

Feature matrix fetched read-only from TaskSorter comparisons, Sheet1/Sheet2
A1:N100, aligned by rows 2–37. Final notes will account for each row.

In progress: shared structured parser, bounded/lazy guest startup with local-only
adapter; optional owned priority/deadline view and acknowledged-time metrics.

Environment: Playwright 1.56.1 browser download requested. Proxy rejects
cdn.playwright.dev and playwright.download.prss.microsoft.com (403 Domain forbidden).
Continue browser testing with installed Chromium; report exact unmatched-browser
check separately unless supported network settings become available.

Unresolved: persisted long-task decomposition, elapsed reconciliation (D4),
multiple prerequisites/cancellation policy, parent importance, optimized capacity
scheduler, permanent erasure/anonymous attribution, guest import, sharing and
assignment, Always On semantics. Optional views do not change active Work order.

## Local completion

Integration implemented: shared structured parser and isolated guest adapter,
owned additive priority/deadline schema, cancellable optional comparison view,
canonical acknowledged metrics/CSV, direct task editing, blocked-only explanation,
current-checkout QA runner and compatibility wrappers. Version notes account for
all 36 spreadsheet rows and register unresolved decisions; local QA covers the
combined journey and Oars fixture. Railway instructions now reference actual
frontend paths and additive storage/deployment requirements.

Clean npm ci succeeded (119 packages). Node 22.23.3 syntax/diff checks and complete
suite passed: 64/64, no skips, system Chromium 154.0.8037.57. Final optional-view
cancellation/context changes receive a browser regression rerun. Matched Chromium
141/build1194 remains locally blocked by the domain allowlist; new Actions workflow
installs/runs the matched browser. Live Clerk, physical mobile/touch, sound output
and production restart/readback are distinct outstanding manual/operational checks.
User explicitly authorized merge/deploy if possible, superseding the source spec's
instruction against automatic release; normal CI/protection checks still apply.

Final browser regression rerun: 7/7 passed, including pairwise cancel without
rank mutation. QA runner status/serve and both compatibility scripts passed
shell syntax; isolated serve `/api/health` returned beta version and new optional
view asset returned HTTP 200. No production task data was used.
