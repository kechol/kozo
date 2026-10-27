---
"@kozo/cli": patch
"@kozo/daemon": patch
---

The work running now holds back its sessions' cost limit from the daily budget, explorer answers included, so kozod starts new work only while the cost recorded today plus what running work may still spend is under `daily_usd`, and concurrent sessions can no longer spend past the budget. `kozo status` shows the amount held back.
