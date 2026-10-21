---
"@kozo/cli": minor
---

Add `kozo prove --base <ref> [--json]`, which runs the tests a diff changes through the new `prove` entries of `.kozo/constraints.yml`, requires them to pass at HEAD and to fail once the non-test changes are reverted in place, and restores the worktree to HEAD; it ends with a `KOZO_PROVE:` line.
