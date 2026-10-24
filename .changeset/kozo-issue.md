---
"@kozo/core": minor
"@kozo/daemon": minor
"@kozo/cli": minor
---

`kozo issue <item>` moves a local item that has no tasks yet to GitHub in GitHub mode: kozod opens an Issue in the item's repository with its title and request, adds the repository's intake label, and cancels the local item, naming the Issue; its next poll takes the Issue up as an item. kozod's gh wrapper allows `gh issue create` only in that form.
