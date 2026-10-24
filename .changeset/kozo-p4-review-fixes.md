---
"@kozo/core": patch
"@kozo/daemon": patch
"@kozo/cli": patch
---

An item whose other tasks were cancelled, by `kozo close --cancel` or by a split again, now completes once its remaining tasks merge, and cancelling one task no longer cancels its whole item while others are open. A post-merge check that fails again after `kozo retry` counts as the same defect and no longer demotes a class a second time. `kozo report` and `kozo admin eval add` report a stopped kozod instead of crashing, a named eval case that cannot be read is an error result rather than the end of the run, and `kozo report --cost` counts a day of a daylight saving change by its own hours.
