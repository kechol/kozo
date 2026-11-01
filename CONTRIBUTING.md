# Contributing to kozo

Thanks for taking the time to contribute. This document covers the development
setup, the checks that must pass, and what to keep out of the repository.

## Requirements

- Bun 1.4.2, pinned in `packageManager` in the root `package.json`
- macOS, or Linux with bubblewrap (`bwrap`) allowed to create user namespaces
  and `socat`; the sandbox tests run only where kozo's sandbox works
- Git and `lsof`
- For the tests that drive a real `claude` session, Claude Code signed in and
  `KOZO_LIVE=1`; without them those tests are skipped

## Getting set up

```sh
git clone https://github.com/kechol/kozo.git
cd kozo
bun install --frozen-lockfile
```

## Building and running kozo from source

```sh
bun run compile                    # dist/kozo and dist/kozod for this platform
bun packages/dashboard/preview.ts  # the dashboard against fictional data
```

Put `dist/kozo` and `dist/kozod` on `PATH` to use them, then follow the
[Quick Start](https://kechol.github.io/kozo/quick-start/).

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

The documentation site in `site/` is an npm package of its own and needs a Node
version Astro supports; CI uses Node 24. Run its checks when you change it, and
change the English page and its Japanese page under `ja/` together:

```sh
npm --prefix site ci
npm --prefix site run format:check
npm --prefix site run build
```

## Commit messages

We use [Conventional Commits](https://www.conventionalcommits.org/): `feat:`,
`fix:`, `docs:`, `refactor:`, `test:`, `chore:`, `ci:`. The scope is optional
and usually the package name, for example `feat(cli): ...`. Explain in the body
why the change is needed. Coding agents follow the full format in
[AGENTS.md](AGENTS.md).

## Changesets and releases

Every user-visible change needs a changeset:

```sh
bunx changeset
```

Pick the bump level and describe the change in one or two sentences; the text
lands verbatim in the changelog. All `@kozo/*` packages share one version.

Releases are cut by maintainers. Merging the "chore: version packages" pull
request bumps the version, and pushing a matching `v<version>` tag makes GitHub
Actions build `kozo` and `kozod` for macOS and Linux and publish them as a
GitHub Release. For a stable version, the workflow then writes
`Formula/kozo.rb` from the release's checksums and pushes it to the
kechol/homebrew-tap repository with the `HOMEBREW_TAP_TOKEN` secret, a token
that may write only that repository's contents. Nobody publishes from a laptop.

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
