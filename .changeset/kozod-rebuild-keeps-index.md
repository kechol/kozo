---
"@kozo/daemon": patch
---

`kozo admin db-rebuild` leaves `kozo.db` as it was when the event logs do not read, instead of empty until kozod starts again.
