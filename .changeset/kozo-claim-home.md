---
"@kozo/daemon": patch
---

Two kozods started at once for the same home can no longer both run, and a pid file left by a crashed kozod whose pid another program now has no longer keeps kozod from starting.
