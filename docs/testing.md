# Testing

How kozo is tested: what each kind of test covers, the shared fixtures and fakes, the sandbox on
macOS and Linux, how to reproduce Linux in a container, and the evals. The commands that CI runs
are in [CONTRIBUTING.md](../CONTRIBUTING.md#checks).

## Kinds of test

Every test runs with `bun test` and no model, unless it says otherwise below.

| Kind | Where | Covers |
| --- | --- | --- |
| Unit | `*.test.ts` beside each module | One module: a schema, a guard rule, a gate's parser, a query |
| State | `packages/core/src/state.test.ts` | Every move of the state machine, and the ones it refuses, from events alone |
| Replay | `testing/src/replay.test.ts` | A recorded factory home in `testing/fixtures/replay-k1` still replays and its chains and seals still check |
| Flow | `packages/daemon/src/flow.test.ts`, `github-flow.test.ts` | kozod end to end on a temporary home and git repository, with the fake agent, judges and GitHub |
| Contract | `packages/worker/src/contract.test.ts` | That each `CodingAgent` runtime keeps the same contract; the live half runs only with `KOZO_LIVE=1` and `claude` installed |
| Sandbox | `packages/verify/src/sandbox.test.ts`, `packages/worker/src/task-sandbox.test.ts` | What a confined command can read, write and reach, on this machine's real sandbox |
| Abuse | `packages/worker/src/abuse.test.ts` | That a real agent told to push, rewrite refs or leave its worktree is refused; runs only with `KOZO_LIVE=1` and `claude` installed, and costs model calls |
| Dashboard | `packages/dashboard/src/*.test.ts*` | Formatting, the API client and rendered components, on happy-dom |
| Documents | `packages/cli/src/site.test.ts`, `packages/core/src/docs.test.ts` | The site's pages and the developer documents against the code |

The state machine is tested without kozod and kozod without a model: a change to how work moves
gets a state test for the move and a flow test for the path.

## Fixtures and fakes

`@kozo/testing` (`testing/src`) is shared by every package's tests:

- `tempDirectory` gives a directory that `await using` removes.
- `git-repository.ts` makes git repositories with commits, and `testGitEnvironment` keeps the
  developer's git configuration out of them.
- `fakeAgent` plays a script of steps for a `CodingAgent`; `factory-fixtures.ts` has the plan,
  report and implement steps the flow tests share, and judges that accept, revise or escalate.
- `fakeGitHub` records every call, keeps branches, pull requests, labels, permissions and
  closes, and can lose the response of the next comment or push, before or after the change.
- `eventWriter` writes event lines with their chain, for tests that start from a log.
- `exampleCharter` and the other documents are valid files to edit in a test.
- `testConfine` is the machine's sandbox where it has one, and no confinement where it has none.
- `recordedLogs` and `replayDirectory` read a recorded home; recompute it with its chains and seals
  when the event version changes (see [Data model](data-model.md#changing-a-format)).
- `bad-changes.ts` is a small shop repository with one good change and a list of bad ones, which
  the verification tests and `scripts/bad-changes.ts` run through every layer.

## The sandbox

kozod refuses to start where it cannot confine commands, so the tests that start kozod need the
sandbox too. The sandbox tests skip where there is none; `testConfine` runs the rest unconfined.

- **macOS:** Seatbelt through `sandbox-exec`, always present.
- **Linux:** bubblewrap, with `socat` and `lsof`. Ubuntu's AppArmor keeps unprivileged processes
  from creating user namespaces; allow them with
  `sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0`. CI does that, then runs
  `platformConfine` the way kozod does at its start, so a broken sandbox fails the job instead of
  skipping its tests.
- A confined command sees `/tmp` and `/run` empty, has a `TMPDIR` of its own and cannot read the
  credentials in the home directory. A test that shares a file
  with a confined command, such as a mark a gate waits for, puts it in the repository's git
  directory or the worktree, which the command can read.
- A path is hidden at its real path: a test that names a temporary directory resolves it first,
  as kozod does, since macOS's `/var` and `/tmp` are links.

### Linux in a container

CI's test job is in `.github/workflows/ci.yml`, on `ubuntu-latest` (x86_64) and
`macos-latest`. To reproduce the Ubuntu runner on another machine, build an image with bubblewrap and the Bun
version that `packageManager` in `package.json` pins (`packages/core/src/docs.test.ts` fails
when they differ):

```dockerfile
FROM ubuntu:24.04
COPY --from=oven/bun:1.4.2 /usr/local/bin/bun /usr/local/bin/bun
RUN apt-get update -qq \
 && apt-get install -y -qq git bubblewrap socat lsof procps ca-certificates nodejs \
 && useradd -m tester
```

Run the suite as the unprivileged user, on a copy of the working tree without `node_modules`,
since the host's builds may not run on Linux (for example
`rsync -a --exclude node_modules ./ <copy>/`). `--privileged` lets
bubblewrap create namespaces, so the container needs no AppArmor change; on Apple silicon, add
`--platform linux/amd64` to both commands to match the runner's architecture. Mounting the host's Docker socket reproduces a runner where
`/var/run/docker.sock` exists behind the `/var/run` link.

```sh
docker build -t kozo-ubuntu <directory with the Dockerfile>
docker run --rm --privileged -v /var/run/docker.sock:/var/run/docker.sock \
  -v <copy>:/src:ro kozo-ubuntu bash -c 'su tester -c "
    cp -r /src /tmp/work && cd /tmp/work && bun install --frozen-lockfile &&
    bun -e \"await (await import(\\\"./packages/verify/src/index.ts\\\")).platformConfine()\" &&
    bun test"'
```

## Evals

Evals measure the factory with real models; they cost model calls and never run in CI.

- `kozo admin eval run` runs the eval cases of a factory definition, each in a throwaway home;
  how to add a case is on the site's
  [Operating kozo](../site/src/content/docs/operations.md#evals) page. The harness is
  `packages/daemon/src/eval.ts`.
- `scripts/bad-changes.ts --model <model>` runs the good change and every bad change of
  `testing/src/bad-changes.ts` through each verification layer, and review once per model, to see
  which layer catches what.
- `scripts/baseline.ts --repo <owner/name>` measures how changes were made and reviewed in a
  public repository's recent history, such as review times and the defects later fixes link to,
  a human baseline to compare kozo's results with.

Both scripts write their results under `.output/`, which stays out of commits.
