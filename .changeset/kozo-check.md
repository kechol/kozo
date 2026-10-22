---
"@kozo/cli": minor
---

Add `kozo check [path] [--json]`, which runs without kozod. Without a path it checks the factory definition as kozod would read it, the Charter, constraints and verify-app.md at the default branch tip of every registered repository, the claude executable's version, the flags kozo relies on and whether claude is signed in, the guard hooks and the sandbox's tools, and exits 1 when a check fails. With a path it checks only the factory definition or the repository `.kozo/` in that working tree, for CI and pre-commit hooks.
