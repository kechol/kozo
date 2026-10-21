---
"@kozo/cli": minor
---

Add `kozo review --base <ref> --goal <text> --done-when <text>... [--model <id>] [--max-cost <usd>] [--out <dir>] [--json]`, which judges the diff in a separate session of the installed `claude` that sees only the diff, GOAL and DONE_WHEN and has no tools, and records accept, revise or escalate with findings, model and cost in `verdict.json`. It exits 0 on accept, 1 on revise and 3 on escalate.
