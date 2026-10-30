---
"@kozo/daemon": patch
---

kozod now stops and exits with status 1 once its event store refuses writes, after an event failed to apply or a log failed to write, so that it starts no more paid sessions whose results it cannot record; its next start replays the logs.
