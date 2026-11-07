---
"@kozo/core": patch
"@kozo/daemon": patch
---

In GitHub mode kozod follows GitHub's irregular answers: failed checks and a pull request without checks no longer break the poll, a change request that the reviewer later approved or that was dismissed no longer sends the task back, an item whose Issue was deleted or moved is held for your attention instead of failing on every poll, and `kozo issue` run again after a failed close finishes with the Issue it opened instead of opening another.
