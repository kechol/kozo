---
"@kozo/daemon": minor
---

`kozod` takes plans of two or more tasks. A split plan always waits for approval in Planning, and a task that depends on another starts only once that task is complete. kozod checks every triage draft before proposing it: the Charter's task and size limits, dependencies without a cycle, no shared scope between tasks that no dependency joins, and every DONE_WHEN condition of the item repeated by a task. A task whose scope reaches a protected path or covers every file is rated high risk. A draft that fails gets one more triage session that is told why, and a second failure holds the item for attention.
