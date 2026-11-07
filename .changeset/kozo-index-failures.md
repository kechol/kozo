---
"@kozo/daemon": patch
---

When kozo.db fails to record an event or to be rebuilt, kozod stops taking events and exits, as it already did for a log it cannot write, so its next start rebuilds the index from the logs instead of running on with an index that misses events or is closed.
