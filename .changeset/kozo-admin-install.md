---
"@kozo/cli": minor
"@kozo/daemon": minor
---

Add `kozo admin install <path> [--json]`, which adds what kozo needs to a repository without overwriting anything there: `AGENTS.md`, a `CLAUDE.md` symlink to it, `.kozo/charter.yml` with `status: incomplete`, `.kozo/constraints.yml` and `.kozo/verify-app.md`, and in GitHub mode `.github/workflows/kozo.yml`, which runs `kozo check .` on pull requests. In local mode the CLI writes the files for you to edit and commit; in GitHub mode kozod commits them on a branch of its own and opens a pull request whose body gives the default-branch ruleset and the `gh api` command an admin can run to apply it.
