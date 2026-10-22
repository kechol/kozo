---
"@kozo/core": minor
"@kozo/daemon": minor
---

`kozod` records every edit of a GitHub Issue it takes as the item's new request. Before it writes the new text to `~/.kozo/items/<ref>.md`, it appends `item.edited` with the new title, the SHA-256 of the new request as runs read it, and whether the Issue's author may write. The item's title in `kozo show` and `kozo list` follows the edit.
