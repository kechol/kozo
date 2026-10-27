---
"@kozo/daemon": patch
---

A failure while polling GitHub, reading the factory definition, reconciling or running automations is now reported and no longer stops the rest of kozod's timed work, and automations match the minute of the tick that runs them even when the work before them takes longer.
