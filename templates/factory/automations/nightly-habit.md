---
version: 1
# Every night at 03:00 in kozod's local time. The item waits for your start approval and plan
# approval, and no new one is added while it is open. Delete this file to stop it.
schedule: "0 3 * * *"
class: bugfix
---

# Fix one error that the code swallows

Find one place where the code catches an error and then ignores it: an empty catch block, a
catch that only logs and carries on as if nothing failed, or a promise whose rejection nobody
handles. Pick the one whose failure a user would notice first.

Make the failure visible where it happens: handle it, or let it reach a caller that can. Add a
test that fails while the error is swallowed. Change nothing else; list other places you find
in the run report instead.
