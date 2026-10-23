---
"@kozo/core": minor
"@kozo/verify": minor
"@kozo/daemon": minor
---

The factory definition may hold automations: `automations/<name>.md` files with YAML front matter of `version: 1`, a five-field cron `schedule` in kozod's local time, an optional `repository` and an optional `class`, then the request under a `# <title>` heading. In local mode, in each minute the schedule matches while kozod runs, kozod adds the request as an item with the source `automation`, unless an open item of the same repository already has its title. Such an item always waits for your start approval and your plan approval, whatever the autonomy level. A schedule missed while kozod was down is not made up. `kozo admin init` writes one example, `automations/nightly-habit.md`, which asks every night at 03:00 for one swallowed error to be fixed; kozo's template supplies no automation to a definition that lacks the file.
