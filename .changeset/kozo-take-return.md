---
"@kozo/core": minor
"@kozo/daemon": minor
"@kozo/cli": minor
---

`kozo take <task>` hands a task to you: kozod stops its session, holds it as paused for the take, in place of a question or attention hold, and prints its worktree and branch. Commit your work there, then run `kozo return <task> <what you changed and checked>`: kozod records the text as an instruction, appends `task.returned`, moves the task to Building and starts its next run at the deterministic checks, so your commits go through the gates, prove, diff-guard, review and verify. `kozo return` refuses while the worktree has uncommitted changes, and a task waiting on approval, a dependency or capacity cannot be taken.
