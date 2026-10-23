---
"@kozo/core": minor
"@kozo/daemon": minor
---

kozo's factory template has a migration blueprint, which runs the deep gates and starts from no failing test. A migration's plan is one chain of tasks, each depending on the one before it, and its first task characterizes: it sets `characterize: true` and adds tests that pin the behaviour the migration keeps. kozod refuses a characterization task's diff when it changes anything but test files, and runs its prove in preserve mode.

A plan task may set `codemod` to one shell command, written as one line of printable ASCII characters. kozod, not the agent, runs it in the task's worktree in the gates' sandbox before the task's first implement session, and commits what it changed as kozo; the session finishes the task from there, and review sees the whole diff. A codemod that fails holds the task for attention, and a plan with a codemod always waits for a human's plan approval. The triage and plan agents' instructions describe both fields.

`kozo show <item>` prints a plan that waits for approval: its class, risk tier and approach, and each task with its codemod.
