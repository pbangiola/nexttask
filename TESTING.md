# Commit 5 testing

## Syntax

```bash
node --check script.js
```

## Exact duplicate

Enter:

```text
Wash dishes
Wash dishes
Read
```

Submit the list.

- A prompt should identify the duplicate.
- Choose OK.
- Sorting should contain `Wash dishes`, `Wash dishes again`, and `Read`.

Repeat and choose Cancel.

- Sorting should contain only one `Wash dishes` task.

## Case and whitespace normalization

Enter:

```text
Email Bob
 email   bob 
EMAIL BOB
```

- The second and third entries should each be detected as duplicates.
- Keeping both should produce unique names, normally `email bob again` and `EMAIL BOB again 2` based on the submitted spelling.

## Collision-safe renaming

Enter:

```text
Plan trip
Plan trip again
Plan trip
```

Keep the duplicate.

- The generated name must not collide with `Plan trip again`.
- It should become `Plan trip again 2`.

## No duplicates

Enter three distinct tasks.

- No prompt should appear.
- Sorting should begin normally.

## Capacity display

While typing duplicates, confirm the capacity preview counts every entered line before duplicate resolution. This reflects what the user has typed; final task count is resolved on submission.
