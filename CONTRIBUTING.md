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

## What to change together

A change of one kind touches the places below in the same commit. Those marked
*checked* fail a test when forgotten; the rest are kept by hand. How kozo is
built is described in [docs/](docs/); start with
[docs/architecture.md](docs/architecture.md).

- **A command or a flag:** the usage in `packages/cli/src/index.ts`, its
  Japanese usage (*checked*), `site/src/content/docs/cli.md` and `ja/cli.md`
  (*checked*), and a changeset.
- **A configuration key** of `factory.yml`, the Charter or the constraints: its
  schema in `packages/core/src`, its configuration page in English and
  Japanese (*checked*), the factory template in `templates/factory` when it has
  a default, and a changeset.
- **Text kozo shows:** a code in `packages/core/src/messages/en.ts` and `ja.ts`
  with the same values (*checked*), or a word in
  `packages/dashboard/src/words.ts` in both languages (*checked*).
- **What the dashboard shows:** `site/src/content/docs/dashboard.md` and
  `ja/dashboard.md`, and a changeset.
- **An environment variable:** the table in
  `site/src/content/docs/operations.md` and `ja/operations.md`.
- **An event type or a persisted format:** a line in `docs/decisions.md`
  first, the schema and its version in `packages/core/src`, `applyEvent` and
  `recordOnlyTypes` in `packages/core/src/state.ts`, the index in
  `packages/daemon/src/index-db.ts` and its version when its tables change,
  `docs/data-model.md` (*checked*), and the recorded replay under
  `testing/fixtures` when the event version changes.
- **A stage, a hold or a move between them:** a line in `docs/decisions.md`
  first, `packages/core/src/work-model.ts` and the edges in
  `packages/core/src/state.ts`, a state test and a flow test,
  `docs/lifecycle.md` (*checked*), the site's concept page in English and
  Japanese, and the dashboard's words.
- **A gh subcommand kozod runs:** `ghAllowed` in
  `packages/daemon/src/github.ts`, which stays without a merge and without
  arbitrary API calls (D-021), its test in `github.test.ts`, and the fake in
  `testing/src/fake-github.ts`.
- **A design invariant:** `AGENTS.md` and `docs/architecture.md` (*checked*).
- **A new term:** `docs/glossary.md`, before the term is used.
- **A runtime dependency:** a line in `docs/decisions.md` first, its license
  checked, and `bun.lock` without registry URLs.

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
