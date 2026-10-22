---
"@kozo/core": minor
"@kozo/daemon": minor
---

`.kozo/constraints.yml` may list `services`, commands that start what the gates need and kozo's command sandbox cannot run, such as a database container. `kozod` runs them outside the sandbox in a new worktree before prepare, read from the default branch as prepare is, and holds the task for attention when one fails. `kozo admin install` writes an empty `services` list into the repository template.
