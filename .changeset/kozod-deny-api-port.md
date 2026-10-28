---
"@kozo/daemon": patch
"@kozo/verify": patch
"@kozo/worker": patch
---

On macOS, the commands kozod confines, prepare, the gates, prove and the agent's `kozo_gates` included, can no longer connect to kozod's API port; every other port of this machine stays reachable, so a test that starts its own server still works. On Linux the command's network already reaches only the worktree's ports.
