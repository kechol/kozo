---
title: Installation
description: What kozo needs on macOS and Linux, how to install it with Homebrew, from a release archive or from source, and how to check the result.
---

kozo is two executables: `kozo`, the command line, and `kozod`, the resident process. Install
both on the same `PATH`.

## Requirements

| Requirement                                                                                                   | Why                                                                                                     |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| macOS, or Linux on x64 or arm64                                                                               | kozo runs only where it can confine the commands it runs.                                               |
| [Claude Code](https://docs.anthropic.com/en/docs/claude-code) on `PATH`, signed in with `claude auth login`   | kozo's agents run on your own `claude`.                                                                 |
| Git                                                                                                           | kozo works in git worktrees and branches.                                                               |
| `lsof`                                                                                                        | kozod finds and stops what an agent session leaves running.                                             |
| On Linux, [bubblewrap](https://github.com/containers/bubblewrap) (`bwrap`), allowed to create user namespaces | It confines the agents' shells and the commands of prepare, the gates and prove.                        |
| On Linux, [socat](http://www.dest-unreach.org/socat/)                                                         | Claude Code's sandbox needs it, and kozo's sandbox carries connections to the allowed ports through it. |

On macOS, `sandbox-exec`, which ships with the system, does the confining.

kozod refuses to start where it cannot confine those commands, and `kozo check` reports why.

## Homebrew

```sh
brew install kechol/tap/kozo
```

The formula installs `kozo` and `kozod` for macOS and Linux, on Apple silicon, Intel and ARM.

## Release archive

Each [GitHub Release](https://github.com/kechol/kozo/releases) carries an archive per platform,
`kozo-<version>-<target>.tar.gz` for `darwin-arm64`, `darwin-x64`, `linux-arm64` and
`linux-x64`, and a `SHA256SUMS.txt`. Check the archive against it, then put both executables on
`PATH`:

```sh
grep kozo-<version>-<target>.tar.gz SHA256SUMS.txt | shasum -a 256 --check
tar -xzf kozo-<version>-<target>.tar.gz kozo kozod
```

## From source

Building needs [Bun](https://bun.sh), at the version `packageManager` pins in `package.json`:

```sh
git clone https://github.com/kechol/kozo.git
cd kozo
bun install --frozen-lockfile
bun run compile
```

`bun run compile` writes `dist/kozo` and `dist/kozod` for the current platform; put both on
`PATH`.

## Check the installation

```sh
kozo --version
kozo check
```

Before a factory definition exists, `kozo check` reports it missing; the other checks, `claude`,
its flags and sign-in, the sandbox and `lsof`, already tell you whether this machine can run
kozo. Continue with the [Quick Start](../quick-start/).

## Where kozo keeps its files

Everything kozo writes lives in `~/.kozo`, or in the directory that `KOZO_HOME` names; see
[Operating kozo](../operations/#where-kozo-keeps-its-data) for what is there.
