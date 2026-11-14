---
"@kozo/verify": minor
"@kozo/daemon": minor
---

Review now judges a diff also against the repository's AGENTS.md, read from the base branch so the diff cannot change it, and against the plan's approach, so a change in the wrong place, around an existing abstraction or against a written rule is sent back.
