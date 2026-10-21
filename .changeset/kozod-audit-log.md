---
"@kozo/daemon": minor
---

`kozod` keeps a complete, tamper-evident record in its event logs.

- Every line carries `prev`, the SHA-256 of the line before it in the same log, and when a run ends kozod seals the run's log with a `log.sealed` event in `~/.kozo/events.jsonl` that records the line count and the last line's hash. kozod refuses to start when a line was changed, removed or reordered, or when a run's log is missing or differs from its seal.
- Notes are events: answers, instructions, approval texts and rejections given through `kozo approve`, `reject`, `say` and `retry`, and the output of a failed check at Complete, are `note.added` events instead of a separate `notes.jsonl`. Instruction queue lines carry `v: 1`.
- Every event made by a write to the local API carries that write's `api_call` ID, and every stage change and hold says who made it (`by`: human or kozod) and why (`reason`). `kozo show` prints the reason of each stage change.
- Every run records what it started from: `run.started` carries the kozo version, the runtime and the SHA-256 of the request as the run read it, and the worker records `session.started` with the claude version, the model and the SHA-256 of the brief and of the instructions.
- Every verdict names the commit it was about: `gates.result` carries the commit the gates ran on and the path of their full output, `handoff.ready` records the commit handed to the human, and `branch.merged` records the commit of the default branch that brought a task branch in, found for merges, fast-forwards and rebased or squashed changes alike, with its committer.
