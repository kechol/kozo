---
"@kozo/cli": minor
---

`kozo diff-guard` counts assertions in pytest, unittest, Go (`t.Error`, `t.Fatal`, testify) and Rust (`assert!`, `assert_eq!`, `assert_ne!`) tests as well, and treats an equality check replaced by a truthiness or not-null check, such as `.not.toBeNull()`, `assertTrue`, `assert.NotNil` or `assert!`, as a weakened test.
