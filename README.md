# kozo

kozo is a personal software factory that runs on your own machine. You hand it
requests, from a local list or from GitHub Issues, and it splits them into small
tasks, implements each task in an isolated git worktree, verifies the result,
and hands you a small diff to read. Merging always stays with you.

Documentation: <https://kechol.github.io/kozo/>

> **Status:** early development, with no release yet. kozod runs the whole loop
> in local mode and GitHub mode on macOS and Linux; build it from source as
> [CONTRIBUTING.md](CONTRIBUTING.md) describes. The documentation site is
> published with the first release; until then its pages are in
> [`site/src/content/docs/`](site/src/content/docs/).

## How it works

- **You write the policy.** Each repository's Charter sets what kozo may do
  there: the paths it never touches, the size of a diff, and which approvals
  each kind of work needs.
- **kozod decides; models only do the judgment work.** Agents classify, plan,
  implement and review; routing, limits, budgets and every check are code.
- **Every diff is checked before you see it**: the repository's own gates,
  limits on size and scope, tests that must fail without the change, a review
  in a separate session, and a run of the app itself.
- **You clear the inbox and merge.** kozo asks for approvals and answers when it
  needs them, and nothing in it can merge.

## Install

kozo needs macOS, or Linux with [bubblewrap](https://github.com/containers/bubblewrap)
and [socat](http://www.dest-unreach.org/socat/), and
[Claude Code](https://docs.anthropic.com/en/docs/claude-code) signed in. kozo's
agents run on your own `claude`.

```sh
brew install kechol/tap/kozo
```

Release archives and building from source are in
[Installation](https://kechol.github.io/kozo/installation/).

## Quick start

```sh
kozo admin init                  # the factory definition in ~/.kozo/factory
# add your repository to repositories in ~/.kozo/factory/factory.yml and commit
kozo admin install ~/src/shop    # then edit .kozo/, set status: ready, commit
kozo check
kozo up
kozo add "Fix the broken link in the cart page footer"
kozo ls                          # approve, answer, then read the diff and merge it
```

The full walkthrough is the [Quick Start](https://kechol.github.io/kozo/quick-start/).

## Documentation

- [Concept](https://kechol.github.io/kozo/concept/): items, tasks, holds, the inbox and autonomy levels
- [GitHub mode](https://kechol.github.io/kozo/github-mode/): Issues in, pull requests out
- [Dashboard](https://kechol.github.io/kozo/dashboard/): the inbox, the board and the detail view
- [Operating kozo](https://kechol.github.io/kozo/operations/): data, budget, pauses, upgrades and troubleshooting
- [CLI](https://kechol.github.io/kozo/cli/): every command
- [Factory definition](https://kechol.github.io/kozo/factory-definition/), [Charter](https://kechol.github.io/kozo/charter/) and [Constraints](https://kechol.github.io/kozo/constraints/): the configuration
- [Security model](https://kechol.github.io/kozo/security/): what agents and commands can and cannot do
- [Architecture](https://kechol.github.io/kozo/architecture/): how kozod, the workers and the API fit together

Each page is also in Japanese.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the development setup and the checks
a pull request must pass.

## Security

Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
