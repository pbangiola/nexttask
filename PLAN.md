# Commit 5 plan: Restore duplicate task handling

This commit changes only `script.js`.

## Behavior

- Preserve duplicate lines while reading the task-entry box.
- Normalize task names for comparison by:
  - trimming leading and trailing whitespace;
  - collapsing repeated internal spaces;
  - comparing case-insensitively.
- Keep the first occurrence unchanged.
- For each later duplicate, prompt the user to keep it under a distinct name such as:
  - `Wash dishes again`
  - `Wash dishes again 2`
- Choosing Cancel removes that duplicate.
- If the user submits duplicates without keeping them, only the first copy enters sorting.
- Generic text-file parsing remains conservatively deduplicated and is not otherwise redesigned in this commit.
