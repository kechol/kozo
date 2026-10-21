---
"@kozo/cli": patch
---

`kozo diff-guard --scope` does not report a new test case outside the scope: a file the diff adds that matches the `tests` globs and is named like one test case, such as `*.test.ts`, `*.spec.ts`, `test_*.py` or `*_test.go`, but not a file a runner loads for every test, such as `conftest.py`, a setup file or a runner's configuration. Existing tests stay protected.
