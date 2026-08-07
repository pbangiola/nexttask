# Commit 6 plan

Restore seamless importing of NextTask-formatted text files.

## Behavior

- Recognize generated headings such as:
  - Uncompleted Tasks
  - Incomplete Tasks
  - Completed Tasks
  - Task List
- Ignore separator lines made from hyphens, em dashes, underscores, equals signs, or asterisks.
- Import unfinished tasks only; do not re-add entries under a completed-tasks section.
- Strip generated presentation syntax:
  - numbering and bullets
  - checkbox markers
  - completion checkmarks
  - trailing `— 15 min`
  - trailing `— blocked` or `— completed`
- Preserve ordinary user text when the file is not recognized as a NextTask export.
- Keep structured CSV importing unchanged.
