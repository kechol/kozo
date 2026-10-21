---
"@kozo/cli": minor
---

`kozo diff-guard` also reports test files that gain a skip, only, todo, fixme, expected-failure or conditional-run marker, existing test files that lose assertions, trade strict matchers for weak ones or move assertions under a new condition, and changes to the scripts that a gate runs in any `package.json`. Lines moved between test files, as in a rename, are not counted as removed.
