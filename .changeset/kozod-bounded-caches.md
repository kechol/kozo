---
"@kozo/daemon": patch
---

A dashboard session now ends after a day without use instead of lasting until kozod stops, and kozod forgets the reminders of approvals no longer waiting and the status comments of Issues no longer open, so its memory no longer grows with every item it has seen.
