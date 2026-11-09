# Overdue deadline priority — November 9, 2026

Plan preserves past-due deadline values. Entering Plan refreshes the current
schedule without requiring the user to move an overdue deadline into the future.
Backlog review and task capture also accept past dates; an explicit No deadline
choice remains available.

Scheduling order is:

1. Tasks in a must-complete window, in importance order.
2. Overdue tasks, in importance order.
3. Ordinary tasks, in importance order, advancing a future-due task only as
   needed to meet its deadline.

A must-complete window means a future deadline's latest start has arrived:
deadline minus remaining effort is no later than now. Existing availability,
calendar reservations and prerequisite effort can require an earlier start.

Overdue work yields to future deadlines even if the overdue task is more
important. A task in a must-complete window keeps its place ahead of ordinary
work. Among conflicting future deadlines, more important work remains protected.
Original importance ranks are retained; urgency changes the scheduled queue.

The backlog and Agenda still merge as two sorted importance lists. Urgency is
applied to the resulting schedule, rather than replacing importance comparisons.
Dates remain in `plan_details.deadline_at` and saved schedule positions remain in
`agenda_tasks`. No schema or data migration is needed.
