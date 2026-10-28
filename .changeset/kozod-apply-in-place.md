---
"@kozo/core": patch
"@kozo/daemon": patch
---

kozod now applies each event to its state in place instead of copying the whole state first, so recording an event costs the same however many items, tasks and runs the factory has; a failure that could leave the state ahead of the logs makes kozod record nothing more until it starts again and replays them.
