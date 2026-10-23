---
"@kozo/daemon": minor
"@kozo/cli": minor
"@kozo/dashboard": minor
---

kozod serves a dashboard at its local address, and `kozo dashboard` opens it in your browser; `kozo dashboard --url` prints the URL instead. The URL carries a code that opens one session, once, within a minute; the page takes it out of the address at once and trades it for a session token that kozod accepts until it stops, so the API token never reaches the browser. The page shows the factory's status (mode, running or paused, runs, what waits for you and today's cost), with a button that pauses or resumes the factory, and the inbox, oldest first. Each inbox entry offers only the verbs that settle it: approve or cancel a start, approve or reject a plan, answer a question, retry, take over, close or cancel what needs attention. There is no merge button and no bulk approval. The page follows light and dark mode, and its content security policy allows only its own origin.
