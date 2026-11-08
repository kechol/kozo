---
"@kozo/core": patch
"@kozo/verify": patch
"@kozo/daemon": patch
---

`.kozo/constraints.yml` may list `together`, paths that change together such as an API and its documentation: kozo refuses a plan that may change one side and gives no task the other, and diff-guard refuses a diff that changes one side alone.
