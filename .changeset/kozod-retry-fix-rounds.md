---
"@kozo/core": patch
"@kozo/daemon": patch
---

`kozo retry` of a task that kozod held in Handoff once its fix rounds were spent now sends the task back to Building with its rounds given back, instead of clearing a hold that the next check sets again; the retry counts as a human's intervention. A retry of a pull request closed unmerged or of a check after the merge keeps working as before.
