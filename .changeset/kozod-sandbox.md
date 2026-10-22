---
"@kozo/verify": minor
"@kozo/daemon": minor
"@kozo/cli": minor
---

`kozod` runs the diff's commands in prepare, the gates and prove in kozo's own sandbox, a macOS Seatbelt profile applied through `sandbox-exec`. They cannot read `~/.kozo` or credential paths, write only the task's worktree and a temporary directory of their own, and reach only this machine; prepare may also reach other hosts and write the package managers' caches. Playwright's Chromium runs inside the sandbox. `kozod` refuses to start where it cannot confine these commands, and `kozo check` reports whether it can.
