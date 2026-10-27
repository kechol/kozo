---
"@kozo/worker": patch
---

An agent's shell can no longer read gh's and git's credentials under a custom `XDG_CONFIG_HOME`: kozod now gives the worker the credential paths it finds in its own environment, which the worker's environment lacks.
