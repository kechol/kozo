---
"@kozo/core": minor
"@kozo/daemon": minor
---

`repositories[].locale` in `factory.yml` sets the language of what belongs to a repository, the factory's `locale` when unset: kozod writes the handoff report, the status and question comments, the pull requests and the label descriptions in it, while label names, comment markers and closing keywords stay as they are.
