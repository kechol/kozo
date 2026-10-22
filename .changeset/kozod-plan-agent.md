---
"@kozo/daemon": minor
---

`kozo reject` keeps an item in Planning, where the plan agent drafts the plan again from the rejected draft and your reasons; kozod checks the new draft and asks for approval again. The second rejection holds the item for attention, and `kozo retry` then drafts it again from Triage. A task that depends on another waits with a `dependency` hold until that task is complete, its brief names the tasks it builds on and their merge commits, and a dependent of a cancelled task is held for attention.
