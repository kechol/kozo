---
"@kozo/cli": patch
---

A `--scope` or `tests` pattern with glob syntax also matches the path spelled exactly like it, so a route such as `app/[slug]/page.tsx` is in a scope that names it.
