# kozo

kozo is a personal software factory that runs on your own machine. You hand it
requests, from a local list or from GitHub Issues, and it splits them into small
tasks, implements each task in an isolated git worktree, verifies the result,
and hands you a small diff to read. Merging always stays with you.

> **Status:** early development, with no release yet. kozod runs the whole loop
> in local mode and GitHub mode on macOS and Linux; build it from source to try it.

## Requirements

- [Bun](https://bun.sh) 1.4.2, the version pinned in `package.json`
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) on `PATH`, signed in
  with `claude auth login`; kozo runs its agents through the Agent SDK
- macOS, or Linux with [bubblewrap](https://github.com/containers/bubblewrap) (`bwrap`)
  allowed to create user namespaces, which kozo confines the gates with, and
  [socat](http://www.dest-unreach.org/socat/) when a repository's gates use the services it
  starts on its worktree's ports

## Getting started

```sh
bun install --frozen-lockfile
bun run compile                  # dist/kozo and dist/kozod; put both on PATH
kozo admin init                  # the factory definition in ~/.kozo/factory
```

1. Add each repository kozo works in to `repositories` in
   `~/.kozo/factory/factory.yml` and commit the change.
2. Run `kozo admin install <path>` for each repository, edit the files it adds
   under `.kozo/`, set `status: ready` in `.kozo/charter.yml` and commit them.
3. Run `kozo check` until every check passes.
4. Start kozod with `kozo up` and add work with `kozo add "<title>" --repo <path>`.
5. Clear what waits for you with `kozo ls` and `kozo dashboard`, read each diff
   and merge it yourself.

Run `kozo` with no arguments to list every command.

## Development

```sh
bun install --frozen-lockfile
bun test              # every test
bun run typecheck     # tsc --noEmit
bun run check         # Biome lint and format check
bun run compile       # dist/kozo and dist/kozod for the current platform
```

See [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.

## Security

Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
