---
"@kozo/core": minor
"@kozo/daemon": minor
"@kozo/cli": minor
---

`kozo admin prune --older-than <days>` has kozod remove all but the event log, report, verdicts and decision log of every run whose item reached Complete or Cancelled at least that many days ago, and record the runs it pruned as `factory.pruned`; `--dry-run` lists them without removing anything. kozod prunes nothing on its own, and every event log stays, so `kozo admin db-rebuild` still works.
