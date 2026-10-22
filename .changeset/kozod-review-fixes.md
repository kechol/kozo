---
"@kozo/verify": patch
"@kozo/daemon": patch
"@kozo/cli": patch
---

Fixes in how `kozod` follows work after handoff:

- A task branch with several commits that is squash-merged, as GitHub's default merge does, is recognised as merged.
- A failing check after the merge of a task that is not its item's last holds the task for attention, and its dependents keep waiting, instead of completing it; `kozo retry` runs the check again.
- Only GitHub's 404 means a login has no permission; any other failure is retried on the next poll.
- One Issue that cannot be read or written no longer stops the rest of its repository from being followed.
- A pull request is followed only for the head that passed final verification, and `kozo retry` after a closed pull request opens a new one.
- The question comment says that replies on the Issue are not read and to answer with `kozo say`.
- An Issue closed on GitHub gets its final kozo labels.
- `kozo check` reads each repository at origin's default branch in GitHub mode, as `kozod` does.
- A change of `mode` in the factory definition applies when `kozod` starts again.
