---
"@kozo/cli": patch
"@kozo/core": patch
"@kozo/daemon": patch
"@kozo/verify": patch
---

The constraints gain an optional `generated`, globs of files a tool writes such as lockfiles. diff-guard counts their lines and files apart, reports them on the `KOZO_DIFF_GUARD` line as `generated=<files>files,<lines>lines`, and leaves them out of the Charter's `max_changed_lines` and `max_files`, so a dependency update no longer fails the limits for its lockfile; scope, protected paths, the test checks, review and prove see them as any file. The constraints template shows lockfiles as an example.
