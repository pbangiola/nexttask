# Codex repair specification: Main QA bugs — timing, project editing and screen state
Reported: 2026-10-13, approximately 4:52–4:59 PM America/Chicago
Triage: 2026-10-13 evening
Repository: pbangiola/nexttask
Reviewed main: db5e05a27d30e22d12382c407704b9204a4e50ca
Open foundation PR: #73, e280df37072e2b8bb34767bdb58ed1d36bb808c8
Open Focus PR: #74, a67640809661a76d4be92c93acdaee8fd5152086

## Objective and authorization
Repair the eight user-observed bugs below as one coherent timing/editor/navigation change, with regression tests and a reviewable draft PR. Do not merge or deploy automatically. Preserve task data and prior durability work.
This report clarifies the product requirements: task names may be entered without upfront timing; missing estimates are collected in a dedicated step; existing estimates survive edits; subtasks can be edited directly; derived project totals update after changes; project context belongs only to related work.

## Evidence and limits
Eight supplied screenshots were visually inspected in this review. They are chat attachments, not repository assets; Codex's local-image path errors are attachment-access failures, not application errors. The observations are transcribed below so images are not needed to implement the tests.
The screenshots were taken on the hosted application before the evening review. A deployed/cached asset need not equal current main. Capture actual frontend asset URLs/versions and backend version before attributing a live symptom to a specific commit.
This review inspected main code and open PR state. It did not reproduce the user flow in a signed-in browser or establish that any repair is already working.

## Delivery branch
Fetch/recheck main and PRs #73/#74 first.
If #74 remains unmerged, make a stacked repair branch from its latest head, targeting codex/focus-durability. This avoids bypassing durable write ordering while editing the same files.
If merged, branch from current main.
Reproduce each bug on the selected baseline; record if a previous PR already resolves it and retain a regression test.
Do not merge sso or Ssoplusmvp wholesale. Port only useful parser/timing ideas into the canonical implementation.
Open a draft PR containing the coherent fixes and QA results; retain original branches.

## Eight bugs in reported order

### B1 — Timing screen remains below sorting
Screenshot 4:52:36: Sort Tasks timer/comparison buttons for tasks 3 and 4 coexist with a lower Current Task: 5 timing form and Finish and View List.
Expected: one workflow screen at a time. Sorting shows only its comparison controls and optional sorting timer; stale timing/Focus forms are absent and cannot submit.
Code lead: prepareSortingDisplay in frontend/ui.js does not clear dynamicContainer; its caller in core.js only hides taskInput. Explicitly tear down the outgoing screen and its listeners/timers.
Test: create tasks 1–5 without timings, collect timings, enter sorting, assert timingEntryScreen/deadlinePage/Focus controls are absent; finish/cancel/reload without duplicate timer handlers.
Also remove the literal visible backslash-n after the final script tag in index.html (seen in multiple screenshots); this is markup text, not a newline.

### B2 — Inserted task bypasses timing
Screenshot 4:52:59: list contains timed tasks 2–5, a new task 6 with no estimate, and task 1 marked blocked.
Expected: inserting an untimed task must lead to a separate estimate step before final insertion/execution; inline estimates remain supported. Existing valid estimates must not be prompted again.
The screenshot does not prove whether task 6 came through Add New Task, blocker insertion or another entry path. Test all applicable paths and record the exact reproduction.
Main Add New Task currently requires inline timing; blocker creation can create a zero-estimate task. Use structured entry records and the same missing-estimate workflow instead of inconsistent rules.
Cancellation returns safely to prior work and preserves its durable interval/session behavior.

### B3 — Project creation requires timings upfront
Screenshots 4:54:19 and 4:54:51: project qa contains plain task names; Continue rejects every line with Add a time estimate to every part, with skip sorting checked and unchecked.
Expected: enter names → optional sorting → dedicated estimate collection for missing task estimates → saved project. Inline timings are optional shortcuts.
Project/subproject container estimate is optional; absence must not block defining its children. Do not silently manufacture a positive estimate.
Main leads: planner.showDefineProject rejects absent projectEstimate; showPartsEntry uses parseTimedTaskEntries and rejects untimed lines; project-editor.showAddProject also requires container minutes.
Use a common parser/continuation across project creation, adding children and new work lists. Preserve identity and estimate occurrence through duplicate review.
Test both skip-sort choices, mixed timed/untimed input and nested project creation. Duration tokens never become task names.

### B4 — Timings disappear when reopening project editing
Screenshot 4:55:46: reopening Oars presents a parts textarea with Oars, Left oar shaping and Right oar shaping, without estimates.
Expected: current saved estimates are visible when editing each task, are prefilled, and survive Save with no changes, rename, reorder and refresh.
Main showPartsEntry populates only child.name but its Continue handler requires timings. This is a confirmed UI mismatch, not proof the database originally lost estimates.
Inspect API/database readback to distinguish absent persisted data from absent display values.
Use canonical task IDs for editing; do not match existing rows by names or positions. Distinct tasks sharing a name must not inherit each other's durations.
If bulk editing remains available, retain structured ID/estimate records rather than treating a names-only textarea as authoritative replacement state.

### B5 — No direct subtask edit
Screenshot 4:58:18: Left oar shaping lists four timed leaf tasks, with selection, Move and Delete only; no Edit action.
Expected: a leaf-task row has Edit (or an equivalent obvious direct entry), prefilled name and estimate, Save and Cancel. Editing must not send the user back to project task-entry/import.
Main project-editor.renderRows creates links only for projects; task rows are plain text. planner.showSummary's Edit Project routes to showPartsEntry.
Add direct leaf editing against /nodes/:id. Keep the same ID, parent, position, completion/elapsed history and dependency references; only requested editable fields change.
Project metadata editing and adding children are distinct actions. Name/timing changes must not recreate the graph.

### B6 — Project timing not recalculated after edits
Screenshot 4:58:18 has child estimates 45+60+60+15 = 180 minutes. That screenshot is internally consistent; the failure is the user's reported behavior after editing. Do not describe 180 as erroneous.
Expected: changed task estimates propagate through nested ancestors and refreshed list/summary/editor/Work displays without manual navigation.
Use the existing canonical backend rollup policy, applied atomically with edits or through an explicit awaited reconciliation. Do not only change a displayed number or sum both a container and its descendants.
Main tree-integrity.rollupProjectMetrics already performs bottom-up aggregation, mainly reached through node reads. Audit mutation responses, stale client data and refresh order.
Regression fixture: Oars → Left oar shaping (45,60,60,15 = 180), Right oar shaping (90,90 = 180); total 360. Change 45 to 30: Left=165 and Oars=345 after Save and after reload.
Move a 15-minute task between projects: source decreases and destination increases; root total stays unchanged. Undo restores totals and structure.
Preserve historical actual time. Keep existing completion/cancellation aggregation policy unless separately approved; do not redesign metrics or elapsed authority here.
For containers with children show the calculated planned estimate clearly. Preserve any genuinely separate initial estimate field; do not claim one exists if the schema only has a single rolled-up field.

### B7 — Plan cannot reach the same project manager as Work
Screenshot 4:58:23 shows Existing Projects with Oars and qa. User could reach management from Work → Resume → Projects, but not Plan → Existing → Manage.
Expected: both paths open the same ID-addressed recursive editor. Back returns to the originating list/project level; it does not loop into creation or wipe estimates.
Main leads: planner project cards use planner-project-card-link while the editor's document-level interception looks for planner-project-link; that interception also maps links to refreshed roots by array index.
Replace fragile class/index interception with explicit project-ID callbacks. Wire Plan summary/manage directly to ProjectEditor.open(projectId, origin).
Scope history to the active editing flow/account; clear obsolete stack state on a new root selection. Test both paths to the same root and nested project, including changed list order and deleted rows.

### B8 — Stale project timing shown on unrelated task
Screenshot 4:59:14: Focus task test timing displays toolbar qa with elapsed/remaining project time. Screenshot alone cannot determine whether test timing is related to qa; the user reports it is unrelated.
Expected: toolbar appears only when the active task belongs to the shown project/work selection. New standalone lists, backlog selections, unrelated inserted tasks and restored work cannot inherit prior project context.
Main currentWorkProjectContext is a mutable global set by startNodes and read by appendProjectToolbar. Audit reset, new-list, add task, transition and recovery.
Bind context to canonical active-task ancestry and session selection, rather than merely to the last project visited. Clear or recompute it at every relevant transition.
Test: run qa, end/reset, start a standalone test timing task → no qa toolbar. Switch to Oars → toolbar shows Oars. Reach unrelated backlog task → no stale project bar. Reload behaves identically.
Do not change elapsed-time authority or infer project deadlines in this repair.

## Implementation sequence
1. Capture baseline reproduction/build identity; add screen-transition and stale-context regressions (B1/B8).
2. Unify structured task entry and missing-estimate continuation (B2/B3).
3. Add ID-based direct task/project editing and shared navigation (B4/B5/B7).
4. Make mutation/reconciliation/refresh update totals coherently (B6).
5. Run the complete user journey in one browser session plus refresh/restart and duplicate-name cases.
One coherent repair PR is preferred. Use separate commits within it if useful for review; do not scatter fixes across prototype branches.

## Acceptance and required evidence
- Record B1–B8 as reproduced, fixed and tested, already fixed with regression, or unresolved. Do not mark done by inspection alone.
- Use actual browser UI + disposable authenticated localhost backend for integration tests, retaining PR #74's durable ordering tests.
- Preserve all existing foundation/Focus tests. New tests must exercise untimed entry and editing; prior timed-only tests do not cover these bugs.
- Show API/database assertions for stable IDs, correct estimates and ancestor totals after save/reload.
- Test asynchronous save delays, repeated navigation, duplicate names, cancel and stale browser snapshots.
- Editing/sorting does not accidentally start extra intervals or transfer task ownership.
- Validate live sign-in/mobile/audio only if available; report them separately from simulated Clerk/browser tests.
- Provide before/after reproduction notes and precise changes in Documentation/MAIN_QA_REPAIR_RESULTS.md.
- No destructive migrations, silent guest import, full branch replacement, production task writes or deployment.

## Attachment portability
Codex should work from this report even if screenshots are unavailable. Do not assume /workspace/scratch paths from this conversation exist in another environment. If images are later attached to the Codex task, use its supplied paths; filenames with the narrow nonbreaking space before PM may require exact quoting.
