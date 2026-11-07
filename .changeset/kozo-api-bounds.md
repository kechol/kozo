---
"@kozo/daemon": patch
"@kozo/cli": patch
---

The event stream of an item, task or run starts with its latest 400 events, which is what the dashboard keeps and what `kozo show -f` now prints before it follows, and a stream that resumes reads what it missed a page at a time; the same approval sent twice is taken once, and a verb that no longer fits the state answers 409 instead of 500.
