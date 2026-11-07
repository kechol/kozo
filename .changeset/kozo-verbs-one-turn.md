---
"@kozo/daemon": patch
---

`kozo take`, `return`, `approve`, `reject`, `retry` and `close` clear a hold and take their next step at once, so kozod can no longer start a run, or the plan agent, on the task or item in the moment between the two.
