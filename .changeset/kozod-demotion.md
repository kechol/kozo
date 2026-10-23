---
"@kozo/core": minor
"@kozo/daemon": minor
---

kozod lowers a work class of a repository one autonomy level on its own, never below L1, when a post-merge check finds a defect, or when a human intervened (took the task, committed to its branch at Handoff or sent it back from there) in more than 30 percent of the class's last ten merged diffs since its last demotion. It records `factory.demoted`, notifies you, and applies the lower level until the repository's Charter changes, so editing the Charter, to keep the lower level or to raise it again, ends the demotion. kozod also works out which classes at L2 have had their last 20 merged diffs all autonomous and free of defects, for a promotion to L3 that only you apply in the Charter.
