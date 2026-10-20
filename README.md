# kozo

kozo is a personal software factory that runs on your own machine. You hand it
requests, from a local list or from GitHub Issues, and it splits them into small
tasks, implements each task in an isolated git worktree, verifies the result,
and hands you a small diff to read. Merging always stays with you.

> **Status:** early development. The repository holds the workspace skeleton,
> and no command does real work yet.

## Requirements

- [Bun](https://bun.sh) 1.4.2, the version pinned in `package.json`
- macOS or Linux

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
