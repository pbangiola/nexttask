# Task Graph Rebuild

This branch changes the architectural center of NextTask without throwing away the working product.

## Principle

A task is durable. A project is durable. A work session does not own either one.

The domain is:

**User → task/project graph → work sessions → ranked session items → work intervals**

Planning and working are views over the same task graph.

## Durable task graph

The existing `tasks` table remains the canonical task/project store. Stable task IDs are identity. `parent_id`, `node_type`, and `independently_actionable` describe structure; `status` describes lifecycle.

Projects are structural nodes. Work normally selects open, independently actionable task leaves.

A long task is not automatically a project. The 20-minute threshold is a decomposition signal, not a validity rule.

## Work sessions

`work_sessions` stores a bounded period of work: start/end, available time, optional hard stop, and the user's end constraint.

`work_session_items` stores the priority ordering selected for that session. Sorting therefore changes a session ranking, not task identity or project structure.

This is intentionally separate from the legacy `sessions` table. The old endpoints remain available while the frontend migrates.

## Work intervals

`work_intervals` records actual work as immutable-ish start/stop intervals tied to a durable task and optionally a work session.

Task `elapsed_ms` can remain as a compatibility/cache field during migration, but history should ultimately be derived from intervals.

This makes pause/resume, browser suspension, estimation analytics, and work across multiple sessions explicit instead of encoding all history in one accumulator.

## UI direction

The UI should move toward one home surface showing the next task, queue, projects, and Add. "Plan" and "Work" are contexts/actions rather than separate data universes.

Application state should be explicit rather than inferred from which DOM element happens to be visible.

## Migration rule

Do not rewrite working behavior all at once. New domain APIs coexist with the legacy session APIs until each frontend workflow is migrated and tested.

The first migration seam is now present in `frontend/task-graph.js` and the authenticated backend endpoints under `/api/work-sessions` and `/api/work-intervals`.
