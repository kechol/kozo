---
"@kozo/cli": minor
"@kozo/daemon": minor
---

The factory definition lives in a git repository at `~/.kozo/factory/`, which `kozo admin init` creates from kozo's template. `kozod` reads `factory.yml`, the agent definitions and the verify-app skill from the tip of its default branch, never the working tree, and uses kozo's template for any file it does not have; a `model` in an agent definition or under `agents.<name>` in `factory.yml` picks that agent's model. A new commit applies as a whole, once a minute, to the runs that start after it; one that does not validate is refused and reported while kozod keeps running the last applied version, which it also falls back to at start. Each run records the commit of the definition it ran with.
