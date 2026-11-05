# Planning update — November 4, 2026

After Clerk sign-in, Work/Plan is the landing page. Recovery still acknowledges
pending writes and pauses open work intervals before showing that page. Previous
screen URLs do not override the sign-in landing. Hierarchy/metrics buttons remain
removed. Project editing and recorded history remain available through management.

Plan compares the combined backlog and Agenda by importance, collects missing
estimates, and presents a deadline review. Blank means no deadline. Saving is
atomic and revision-checked, replaces the current Agenda, and clears backlog.
No conflicting previous Agenda schedule is retained. A repeated save request ID
returns its original acknowledgement.

The scheduler begins in sequential importance order and advances late tasks.
It rejects a move that delays a more important task past its deadline. Tasks
without deadlines can be displaced. Impossible deadlines remain visible as
conflicts; executable tasks are not silently dropped merely for being late.
Prerequisites, explicit starts, working hours, and split-task settings remain
constraints. Fixed calendar events consume their exact time intervals. The old
20% reserve no longer reduces capacity and its control is removed.

Work Create ranks by importance and does not generate deadlines. Estimates can
exceed the optional hard stop. Work Resume asks about a hard stop, then:

- Empty backlog: immediately start the first executable Agenda task when there
  is no hard stop or it fits; otherwise offer it against the first task that fits.
  If nothing fits, show the first task.
- Nonempty backlog: offer its first executable task against the first executable
  Agenda task whose saved start has passed. If none is due, use backlog order.

Ending Work records remaining queue tasks as backlog. Blocked tasks retain their
prerequisite relationships and cannot start until eligible.

Agenda lists saved start/end times and importance; fixed events appear in time
order. Calendar displays the same schedule in a weekly grid, with local-time
labels and UTC `.ics` export. External calendar sync is outside this update.

## Files and database

- `frontend/agenda.js`: planning review, saved Agenda, Calendar, export and Resume.
- `frontend/agenda-scheduler.js`: pure Resume selection and iCalendar encoding.
- `frontend/plan-domain.js`: importance/deadline scheduling with existing constraints.
- `frontend/auth.js`: landing and versioned loader.
- `frontend/focus-durability.js`: journaled session-end backlog handoff.
- `frontend/plan.js`, `frontend/ui.js`, `frontend/work-planner.js`: existing
  management, estimates and project queue integration.
- `backend/agenda-store.js`: current Agenda and backlog persistence.
- `backend/plan-routes.js`, `backend/plan-store.js`, `backend/public-assets.js`:
  authenticated APIs, scheduling integration and static asset allowlist.

Railway uses the existing persistent SQLite database at
`$RAILWAY_VOLUME_MOUNT_PATH/task_sorter.db`. Additive schema migration 6 creates
`agenda_tasks`, `agenda_backlog`, `calendar_events`, and `agenda_state`.
`plan_details` continues to own deadlines and remaining estimates;
`plan_comparisons` retains existing sibling comparisons. `agenda_tasks` stores
the current combined importance rank separately from schedule position and
segment timings. Revision triggers cover schedule, backlog and calendar writes.
Existing task IDs, owners, hierarchy, completion history, intervals, and the
Railway volume are retained. The migration runs when this backend starts;
pushing the feature branch alone does not establish a Railway deployment.

## Saved sorting progress

Entering Plan reuses the saved sequential importance order. With no new backlog
or overdue deadlines, Plan opens the current Agenda directly. Carry-over tasks
with saved ranks go to deadline review without repeated comparisons. New tasks
are sorted and merged into the saved order; saved tasks are not compared against
each other again. Completed comparisons are retained if the user leaves before
saving deadlines. “Reorder importance” explicitly starts a fresh full sort.
Separate tasks with the same name retain separate identities.
