---
"@kozo/core": minor
"@kozo/verify": minor
"@kozo/daemon": minor
"@kozo/cli": minor
---

`kozo say --ask <ref> <question>` answers a question about an item, a task or a run without touching the work. kozod gives the explorer agent, a session without tools, the question and its records as untrusted data: the request, the plan or the draft waiting for approval, every task's stage and hold, the subject's last 60 events, and for a task its run reports, decision logs and diff stat. The session is an explorer run of its own with its cost recorded, and kozod refuses an ask while the daily budget is spent. The factory definition may override the explorer's instructions and model in `agents/explorer/agent.md`; kozo's template has one.
