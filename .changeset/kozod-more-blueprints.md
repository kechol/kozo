---
"@kozo/core": minor
"@kozo/verify": minor
"@kozo/cli": minor
"@kozo/daemon": minor
---

kozo's factory template has blueprints for docs, refactor and perf work besides bugfix and deps. None of them starts from a failing test, docs leaves out verify-app, and perf runs at least the full gates.

`kozo prove --preserve` checks a change that keeps behaviour: the tests the diff adds or changes must pass both with and without the non-test changes, and a diff that changes no test passes. kozod runs prove this way for a blueprint that does not reproduce when a human chose the work class, by asking for it or by approving the plan, or when the diff changes only dependency manifests and lockfiles, where it used to skip prove. A class that only the triage session chose still needs a test that fails without the change. The handoff report says which way prove checked the tests.

The implement agent's instructions say that a test added under such a blueprint must pass before the change too.
