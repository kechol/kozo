---
"@kozo/daemon": patch
---

An item of two or more tasks is checked as a whole after its last merge: the verify agent drives the app on the default branch against the item's DONE_WHEN, and an item that falls short goes back to Triage with what failed, without counting as a defect.
