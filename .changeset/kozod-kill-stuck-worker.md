---
"@kozo/daemon": patch
---

A worker that has not exited 15 seconds after kozod asked it to stop now gets SIGKILL and its session ends as lost, so a stuck worker no longer keeps `kozo down` and kozod's stop waiting for ever.
