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

```sh
brew install kechol/tap/kozo
```

kozo needs macOS, or Linux with bubblewrap and socat, and Claude Code signed in;
[Installation](https://kechol.github.io/kozo/installation/) lists every
requirement and the other ways to install. Then follow the
[Quick Start](https://kechol.github.io/kozo/quick-start/), which takes one
request from `kozo add` to your merge. Every page of the
[documentation](https://kechol.github.io/kozo/) is also in Japanese.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the development setup and the checks
a pull request must pass.

## Security

Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
