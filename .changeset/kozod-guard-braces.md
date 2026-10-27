---
"@kozo/worker": patch
---

The guard now treats a word with brace expansion, such as `{g..g}it` or `{gh,true}`, as built from an expansion, so a command name or git subcommand spelled that way is refused like one built from a variable; a lone brace, a group command and find's `{}` are unaffected.
