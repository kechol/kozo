# Contributing to kozo

Thanks for taking the time to contribute. This document covers the development
setup, the checks that must pass, and what to keep out of the repository.

## Requirements

- Bun 1.4.2, pinned in `packageManager` in the root `package.json`
- macOS or Linux

## Getting set up

```sh
git clone https://github.com/kechol/kozo.git
cd kozo
bun install --frozen-lockfile
```

## Checks

CI runs the same commands. Run them before opening a pull request:

```sh
bun run check         # Biome lint and format check; `bun run format` fixes formatting
bun run typecheck     # tsc --noEmit
bun test
bun run compile       # dist/kozo and dist/kozod
```

Commit `bun.lock` without registry URLs. If a local registry mirror writes its
URL into the lockfile, replace the URL with `""` before committing.

## Commit messages

We use [Conventional Commits](https://www.conventionalcommits.org/): `feat:`,
`fix:`, `docs:`, `refactor:`, `test:`, `chore:`, `ci:`. The scope is optional
and usually the package name, for example `feat(cli): ...`. Explain in the body
why the change is needed. Coding agents follow the full format in
[AGENTS.md](AGENTS.md).

## What to keep out of the repository

This is a public repository. Please do not add:

- Real company names, internal hostnames or internal project names
- Credentials, tokens or personal email addresses
- Code or data copied from private repositories, including requests and diffs
  used to evaluate the factory
- Absolute paths containing a home directory, including in test fixtures; use
  temporary directories or paths relative to the repository root

## Security issues

Do not open a public issue for a vulnerability. Follow [SECURITY.md](SECURITY.md).
