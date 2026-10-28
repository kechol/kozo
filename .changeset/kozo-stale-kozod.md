---
"@kozo/cli": patch
"@kozo/daemon": patch
---

`kozo down` now signals the pid in `kozod.pid` only when kozod names it as its own or the process is kozod, so a pid file left by a crash no longer stops another process; a kozod that does not answer within 5 seconds counts as down instead of hanging every `kozo` command; and an answer that is not JSON is reported in a sentence instead of a stack trace.
