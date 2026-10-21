---
"@kozo/cli": minor
---

Add `kozo diff-guard --base <ref> [--head <ref>] [--scope <glob>]... [--json]`, which checks the diff from the merge base against the Charter and constraints at the tip of the base ref: changed lines and files over the limits, files outside the scope, protected paths and changes to existing test files. A protected path also covers everything under what it matches, read both as a glob and as a literal path; a scope written as a plain path without glob syntax covers everything under it. `.kozo/constraints.yml` now requires a `tests` list of globs naming the test files.
