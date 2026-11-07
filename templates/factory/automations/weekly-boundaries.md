---
version: 1
# Every Monday at 04:00 in kozod's local time. The item waits for your start approval and plan
# approval, and no new one is added while it is open. Delete this file to stop it.
schedule: "0 4 * * 1"
class: refactor
---

# Fix one place that breaks the repository's boundaries

Read the Structure and boundaries section of AGENTS.md. Find one place where the code breaks
it: a module that depends on one it may not, code of one kind in another kind's place, or a
piece made again where the section names one to reuse. Pick the one whose fix is smallest and
keeps behaviour.

Fix that place alone, keeping every test passing. List the other places you find in the run
report instead. If AGENTS.md has no such section, ask what the boundaries are rather than
guessing them.
