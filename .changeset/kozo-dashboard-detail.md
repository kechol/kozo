---
"@kozo/daemon": minor
"@kozo/dashboard": minor
---

The dashboard shows the detail of an item, a task or a run, reached from the inbox and the board. An item shows its plan, or the draft that waits for your approval with each task's codemod, its tasks, runs and cost. A task shows its DONE_WHEN and scope, its latest run's progress through the blueprint, the run report, the review and verify verdicts with verify's evidence images, every decision log, its diff and its cost. Each shows its events as they happen, and offers the verbs it takes now: send or answer, pause or resume, retry, take it over or give it back, and cancel.

The local API serves the detail view's reads: `GET /api/refs/<task>/diff`, `GET /api/refs/<task>/records` and `GET /api/runs/<run>/evidence/<path>`, which serves only files inside the run's evidence directory, never as a page, and anything but an image or plain text as a download. An item's detail now carries its cost.
