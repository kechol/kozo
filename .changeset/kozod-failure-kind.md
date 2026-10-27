---
"@kozo/daemon": patch
"@kozo/testing": patch
"@kozo/worker": patch
---

A failed agent session now says what kind of failure it was, an API failure, a spent limit, a finish without an answer or a crash, and only three API failures in a row pause the factory; three agents that answer without the structured result no longer pause it as an outage.
