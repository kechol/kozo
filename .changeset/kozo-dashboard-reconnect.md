---
"@kozo/dashboard": patch
---

The dashboard's timeline now follows a reference again after kozod restarts or the stream breaks, from the last event it showed, with a pause that grows to 30 seconds; before, it stood still while the lists kept refreshing.
