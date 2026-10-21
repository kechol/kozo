---
"@kozo/cli": minor
---

Add `kozo diff-guard --base <ref> [--head <ref>] [--scope <glob>]... [--json]`, which checks a diff against the Charter and constraints at its merge base: changed lines and files over the limits, files outside the scope, protected paths and changes to existing test files. `.kozo/constraints.yml` now requires a `tests` list of globs naming the test files.
