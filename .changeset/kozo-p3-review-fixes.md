---
"@kozo/core": patch
"@kozo/daemon": patch
"@kozo/dashboard": patch
---

Fixes from reviewing the P3 work: `kozo resume` no longer hands back a task you took, which only `kozo return` does, and `kozo return` refuses while the worktree is not on the task branch. A task that characterizes must add a test that a prove entry runs, and prove checks it whatever the risk tier. An explorer run of a task no longer counts as an attempt when the task is first claimed. A cron day field that starts with `*`, such as `*/2`, counts as unrestricted, as in cron. The dashboard no longer goes blank when you move from one reference's detail to another's or open a malformed address.
