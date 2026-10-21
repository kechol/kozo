---
"@kozo/cli": minor
---

Add `kozo gates [--level fast|full|deep] [--base <ref>] [--json]`, which runs the gates of one level from `.kozo/constraints.yml`, read at the tip of `--base` when given, and ends with a `KOZO_GATES:` line; a missing constraints file, an invalid one or an undefined level reports `status=MISCONFIGURED`.
