---
"@kozo/core": minor
"@kozo/daemon": minor
"@kozo/cli": minor
---

Eval cases: `kozo admin eval add <run>` drafts the eval case of a run's item, its repository, start commit, request and the outcome it reached, into the factory definition's `evals/` for you to finish with hidden tests and checks and commit. `kozo admin eval run [<case>...]` runs the cases, or the named ones, each in a throwaway factory home on a clone of its repository at its start, approving every start and plan and merging every handoff, then lays a complete case's hidden tests over the result and runs its prepare and checks in kozo's sandbox; it prints each case's outcome, what a human must still check by hand, the share that reached the expected outcome and the cost, which is outside the factory's daily budget. A case that names an upstream issue reads its body with gh and refuses it when the body changed since the case was made.
