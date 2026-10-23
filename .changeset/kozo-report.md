---
"@kozo/daemon": minor
"@kozo/cli": minor
"@kozo/core": patch
---

`kozo report` prints the metrics over the diffs merged in the last 30 days, or the last `n` with `--days <n>`: the autonomy rate, the post-merge defect rate, the median cost per diff, the median time to merge, the revise rate and the questions and attention holds waiting now, with the classes kozod proposes to raise to L3. `--review` adds each class's level as kozod applies it, its demotions and the window's cost, and `--cost` shows each day's cost in the window and today's against the daily budget; `--json` prints what `GET /api/report` answers.
