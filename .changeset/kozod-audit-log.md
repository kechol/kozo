---
"@kozo/daemon": minor
---

`kozod` keeps a complete, tamper-evident record in its event logs.

- Every line carries `prev`, the SHA-256 of the line before it in the same log, and when a run ends kozod seals the run's log with a `log.sealed` event in `~/.kozo/events.jsonl` that records the line count and the last line's hash. kozod refuses to start when a line was changed, removed or reordered, or when a run's log is missing or differs from its seal.
- Notes are events: answers, instructions, approval texts and rejections given through `kozo approve`, `reject`, `say` and `retry`, and the output of a failed check at Complete, are `note.added` events instead of a separate `notes.jsonl`. Instruction queue lines carry `v: 1`.
