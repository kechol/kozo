# Agent instructions for kozo

kozo is a personal software factory that runs on your own machine. It takes
requests from a local item list or from GitHub Issues, splits them into small
tasks, and keeps producing verified diffs while nobody is watching. The human
writes the policy, clears the inbox, reads each diff and merges it.

These instructions apply to the entire repository.

## Working in this repository

- Read the relevant implementation, callers and tests before editing. Keep
  changes within the request; avoid unrelated refactoring or dependencies.
- Preserve other contributors' uncommitted and staged work. Stage only the
  files or hunks you own.
- Make ordinary implementation decisions autonomously. Choices about
  architecture, dependencies, the data model, public APIs or authentication go
  through `docs/decisions.md` first (see Workflow).
- For review or investigation requests, report findings without modifying
  code unless fixes are requested.
- Put local reports, screenshots and scratch artifacts in `.output/` or an OS
  temporary directory, and keep them out of commits.
- Write repository documentation, code comments and commit messages in
  English. Respond to the user in their preferred language.

## Documentation and ledgers

Markdown ledgers record what exists, one line per entry. Git commit messages
hold the reasons, the deliberation and the implementation plans. Ledger
entries and commits are linked by IDs such as `T-012` and `D-003`.

| File | Contents | In git |
| --- | --- | --- |
| `README.md` | Overview for users | yes |
| `site/` | User documentation, each page in English and in Japanese | yes |
| `AGENTS.md` | Instructions for coding agents | yes |
| `docs/architecture.md` | For developers: the packages, the processes, the trust boundaries and the code that keeps each design invariant; read it before changing what crosses a boundary | yes |
| `docs/data-model.md` | For developers: the event logs and what is built from them, each event type, the index and the versioned formats; read it before changing what kozo persists | yes |
| `docs/lifecycle.md` | For developers: the stages, holds and run states, the code that moves each, and one task's run through the blueprint; read it before changing how work moves | yes |
| `docs/testing.md` | For developers and agents: the kinds of test, the fixtures and fakes, the sandbox on macOS and Linux, Linux in a container, and the evals; read it before writing a test | yes |
| `docs/glossary.md` | Terms and their names in code | yes |
| `docs/decisions.md` | Decisions (`D-NNN`) | yes |
| `docs/backlog/` | Tasks (`T-NNN`), one file per Epic, listed in `INDEX.md` | no, maintainer-local |

- Keep operational documentation to these files. At the repository root, the
  only Markdown files allowed are `README`, `AGENTS`, `CONTRIBUTING`,
  `CHANGELOG`, `LICENSE`, `SECURITY` and `CODE_OF_CONDUCT`.
- Don't create other Markdown files whose role overlaps a ledger; ask first
  when one seems necessary. Generic names such as
  `SUMMARY.md`, `NOTES.md`, `PLAN.md` and `TEST_RESULTS.md` are never allowed.
- Don't `@import` a ledger, since it would load in full every session.
  **Read the rules at the top of a ledger before editing it.** The backlog
  rules are in `docs/backlog/INDEX.md`.
- `site/` describes what users see and do. The developer documents in `docs/`
  describe how kozo is built: its modules, persisted formats, transitions and
  tests, in English only. A developer document links to the site page for a
  concept instead of explaining it again, and a site page names no module,
  schema or code path.
- The backlog is maintainer-local and ignored by git. When it is absent, skip
  the backlog steps below and never invent task IDs.

### Workflow

- Before implementing, read `docs/decisions.md` and don't contradict an
  existing decision. If the work requires contradicting one, report it and
  wait for instructions.
- Before writing code for a choice about architecture, dependencies, the data
  model, a public API or authentication, append one line to
  `docs/decisions.md` with the status `Proposed`.
- When starting a task, mark it doing in its Epic file under `docs/backlog/`,
  present an implementation plan, and **wait for approval before writing
  code**.
- Check `docs/glossary.md` before naming a new concept (see Terms).
- Before committing, check "What to change together" in `CONTRIBUTING.md`
  for the kind of change.
- When asked about past reasons, check `git log --grep` instead of guessing.

### Terms

- `docs/glossary.md` holds every term definition. Code, ledgers, commit
  messages and conversation use its spellings.
- Check it before naming a new concept. Use the existing term when there is
  one; otherwise add the term **before** using it.
- Don't use the words in the Avoid column, and never create two terms for the
  same thing.
- If an instruction uses a spelling that differs from the glossary or a word
  from the Avoid column, point it out instead of silently replacing it.
- When renaming, keep the old name in the Former name column and replace it in
  code and ledgers in the same commit. A rename that reaches a public API or
  the data model needs a line in `docs/decisions.md` first.
- Follow the format rules at the top of the glossary.

### User documentation

- A change to a command, a flag, a configuration key, an environment variable,
  what the dashboard shows or any behaviour a page describes changes its pages
  in `site/src/content/docs/` in the same commit, the English page and its
  Japanese page together.
- Every English page has a Japanese page at the same path under `ja/` and an
  entry in the sidebar in `site/astro.config.mjs`.
- `packages/cli/src/site.test.ts` checks the CLI page against `kozo`'s usage,
  the configuration pages against the schemas, and the Japanese pages and the
  sidebar against the English pages; the rest is kept in step by hand.
- Write the Japanese pages as natural Japanese, translating the meaning rather
  than the English sentence structure. Keep glossary terms, commands, keys and
  paths in their English or code form, and put no ASCII space between Japanese
  words.

### Commit messages

Use this format for every commit. Don't make summary-only commits such as
`update`, `fix` or `wip`.

```text
<type>(<scope>): <one-line summary>

Why: <background in one to three sentences>
How: <the approach taken; the core of the decision, not implementation details>
Alternatives: <options considered and not taken, and why; omit if none>
Impact: <debt taken on or constraints this creates; omit if none>

Task: T-NNN
Decision: D-NNN
Assisted-by: <agent>:<model ID>
```

- Use Conventional Commits types such as `feat`, `fix`, `docs`, `refactor`,
  `test`, `chore` and `ci`, with an optional package scope such as `core`,
  `daemon` or `cli`.
- `Task:`, `Decision:` and `Supersedes:` are git trailers with one reference
  per line; several are allowed.
- A change that involves a decision always carries `Decision:`. A change with
  a related task always carries `Task:`.
- To settle a decision before any code depends on it, make an empty commit
  (`git commit --allow-empty`) whose body gives the reasons and carries the
  `Decision:` trailer.
- An agent-assisted commit ends with exactly one `Assisted-by:` trailer, for
  example `Assisted-by: Claude:claude-opus-5-5`. Add no `Co-Authored-By:` or
  `Signed-off-by:` trailers and no generated-by notice.
- A squash merge keeps the body and the trailers in the squashed message.

Look up history with:

```sh
git log --grep='Decision: D-003'      # everything about one decision
git log --grep='Task: T-012' --stat   # what one task changed
```

### Splitting a ledger

The backlog is split into one file per Epic. When `docs/decisions.md` or
`docs/glossary.md` meets a split signal in its header, report it instead of
starting. After approval:

1. Do it in one go. A staged migration scatters information across two places.
2. Never renumber IDs, since commit trailers would stop resolving.
3. Create `INDEX.md` (one entry per line) in the new directory and move the
   ledger's rules there.
4. Rewrite this section and the file table above for the new layout.
5. Keep the migration commit free of anything other than the move.

## OSS and information handling

kozo is published as public OSS. Treat source, examples, commit messages,
issues and release artifacts as public.

- Use fictional or sanitized examples. Never add employer or customer
  material, internal domains, private project names, credentials or tokens.
- Eval cases and baselines built from private repositories stay in the private
  factory definition repository, never in this one.
- Avoid personal email addresses, home-directory paths and machine details in
  fixtures and documentation. Use repository-relative paths, temporary
  directories and reserved example domains such as `example.com`.
- Only contribute code and assets whose redistribution rights are established,
  and check the license of a runtime dependency before adding it.
- Inspect staged changes before describing them as safe to publish. Don't rely
  on a developer's global ignore configuration.

## Design invariants

These invariants hold everywhere in the code.

- Only kozod writes state. The CLI and the dashboard are stateless clients of
  the local API.
- Decisions that can be made deterministically are code in kozod. Models only
  classify, draft plans, implement and review.
- Humans always merge. Nothing in kozo has a merge command, and the gh wrapper
  allows only listed subcommands.
- Workers hold no GitHub credentials and write only inside their worktree.
  Only kozod pushes and opens pull requests, and only after verification
  passes.
- Event logs are append-only, the SQLite index can always be rebuilt from
  them, and every persisted format carries a version.
- Request bodies are untrusted data wrapped in `<request trust="untrusted">`,
  never instructions.
- The local API binds to `127.0.0.1`, requires the API token, checks Origin on
  writes and enables no CORS. kozo opens no public port.

## Toolchain and commands

Use the Bun version pinned in `packageManager` in the root `package.json` and
commit `bun.lock`. Keep registry URLs out of the lockfile: when a local
registry mirror writes its URL into `bun.lock`, replace the URL with `""`
before committing.

```sh
bun install --frozen-lockfile
bun test              # every test; append a path to narrow it
bun run typecheck     # tsc --noEmit
bun run check         # Biome lint and format check
bun run format        # Biome format --write
bun run compile       # dist/kozo and dist/kozod for the current platform
bun packages/dashboard/preview.ts  # the dashboard against fictional data
```

The documentation site in `site/` is an npm package of its own, on a Node
version Astro supports (CI uses Node 24). Its `.npmrc` keeps registry URLs out of
`site/package-lock.json`.

```sh
npm --prefix site ci
npm --prefix site run dev           # serve the site locally
npm --prefix site run build         # the static build, which checks each page's front matter
npm --prefix site run format:check  # Prettier; `format` fixes it
```

## Releases and external actions

- Add a changeset (`bunx changeset`) for every user-visible change. All
  `@kozo/*` packages share one version through a fixed group.
- Releases come only from GitHub Actions: merging the version pull request
  bumps the version, and a matching `v<version>` tag publishes the GitHub
  Release and the documentation site. Never build or publish release artifacts from a laptop.
- Pushes, pull requests, issues, tags, releases, publication and other changes
  to external services require explicit authorization in the task. Permission
  to implement or commit locally does not authorize them.
