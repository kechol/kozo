---
"@kozo/daemon": patch
---

Gates that are MISCONFIGURED in the check after a merge hold the task for attention instead of counting as a defect, so the class is not demoted and the item does not go back to Triage; `kozo retry` runs the check again once the constraints are fixed.
