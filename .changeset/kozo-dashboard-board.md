---
"@kozo/core": minor
"@kozo/daemon": minor
"@kozo/cli": minor
"@kozo/dashboard": minor
---

The dashboard has a board: one column per stage, showing items or tasks. An item's card shows its hold, its work class, its autonomy level and how many of its tasks are complete or held; a task's card shows its hold and revisions. In local mode the board adds items as `kozo add` does, and the arrows on an open item's card move it up or down.

Items now have an order in which kozod starts their work, the order they arrived in until you move one: `kozo reorder <item> [--before <item>]` moves an item before another, or to the end, and appends `item.reordered`. Triage, planning and every task's runs start in item order, and an item's tasks in plan order; a merged task's check still comes first. `kozo ls items` lists items in this order, each open one with the class and level it runs at.
