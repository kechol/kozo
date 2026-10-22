---
"@kozo/verify": patch
---

A command in kozo's command sandbox can no longer remove, rename or replace the worktree, a package cache or pnpm's lock directory it may write, so it cannot turn one into a link that a later run would follow. A root in a directory everyone may write, such as /tmp, counts only as a directory of the factory's user, and a package cache that does not exist is not created inside the sandbox.
