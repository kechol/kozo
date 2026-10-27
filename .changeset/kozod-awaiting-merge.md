---
"@kozo/core": patch
"@kozo/daemon": patch
---

The inbox, `kozo ls` and the dashboard show a task as awaiting merge only once its final verification passed, the same condition the backpressure and the GitHub sync use, instead of as soon as it reaches Handoff while the deep gates still run or after a run that did not finish.
