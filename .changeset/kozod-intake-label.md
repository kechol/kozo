---
"@kozo/core": minor
"@kozo/daemon": minor
---

In GitHub mode a repository in `factory.yml` may set `label`, and `kozod` then takes only the open Issues that carry that label as items. A label starting with `kozo:` is refused. An Issue labelled `kozo:paused` still pauses the factory without the label. `kozod` reads the Issue of each open item by its number when the listing misses it, so an item stays followed after its Issue loses the label or falls past the listing's 200 Issues.
