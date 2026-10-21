---
"@kozo/cli": minor
---

`kozo` gains the commands for running the factory: `up` and `down`, `status [--line]`, `add`, `ls [inbox|items|tasks|runs]`, `show <ref> [-f] [--diff]`, `say`, `approve`, `reject`, `pause`, `resume`, `retry`, `close --done|--cancel` and `admin db-rebuild`. Every command takes `--json` and exits with 0 for success, 1 for failure, 2 for a usage error, 3 when the result waits for a human and 4 for an unknown reference. The CLI sends the API token only after kozod proves it holds the same token.
