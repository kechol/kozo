---
"@kozo/daemon": patch
---

The GitHub sync now compares an Issue's creation with the repository's registration as times, so an Issue opened just before the registration is no longer trusted for a difference in fractions of a second; it reads up to 10,000 open Issues instead of 200; and kozod's gh wrapper allows `gh issue edit` only to add and remove labels.
