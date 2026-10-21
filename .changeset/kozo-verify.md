---
"@kozo/cli": minor
---

Add `kozo verify --base <ref> --goal <text> --done-when <text>... [--model <id>] [--max-cost <usd>] [--out <dir>] [--json]`, which runs the app by `.kozo/verify-app.md` at the tip of the base ref in a sandboxed session of the installed `claude`, exercises each DONE_WHEN condition, records pass, fail or blocked in `verdict.json` and copies the evidence into `<dir>/evidence/`. Processes the session leaves in the worktree are stopped afterwards.
