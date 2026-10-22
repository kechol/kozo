---
"@kozo/daemon": minor
---

`kozod` reads each work class's blueprint from `blueprints/<class>.yml` in the factory definition, falling back to kozo's template and then to the bugfix blueprint. A blueprint lists its nodes in the fixed order, may leave out verify-app, says whether it starts from a failing test and may raise the gate level its deterministic check runs at; it never removes a check the risk tier sets: verify-app runs whenever the tier asks for verify, and a blueprint that does not reproduce goes without prove only for a diff of dependency manifests and lockfiles. The template's deps blueprint starts from no failing test and runs the deep gates, so a dependency update no longer fails prove for having no test.
