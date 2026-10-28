---
"@kozo/cli": patch
---

`kozo check` now fails without `lsof`, which kozod needs before every session, looks for the flags of `claude --print` too when the factory runs `runtime: cli`, and its hooks line says where the guard sits for the runtime in use.
