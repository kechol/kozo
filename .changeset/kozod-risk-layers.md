---
"@kozo/daemon": minor
---

The risk tier alone sets how deeply `kozod` verifies a task: low runs the fast gates, diff-guard and review; normal adds prove and verify on the full gates; high runs the deep gates. Each task keeps its own tier, starting from the plan's, and `kozod` raises a low task to normal, recorded as a `risk.raised` event, when its diff changes a file that is not documentation.
