# Data model

What kozo keeps, which code writes and reads each part, the events, the index, and how a
persisted format changes. Where each file sits in a factory's home, and what a user may do with
it, is on the site's
[Operating kozo](../site/src/content/docs/operations.md#where-kozo-keeps-its-data) page; the
paths come from `kozoHome` and `runFiles` in `packages/core/src/home.ts`.

## The record and what is built from it

The event logs are the record: `events.jsonl` for the factory and `runs/<run>/events.jsonl` for
each run. Only `EventStore` in `packages/daemon/src/event-store.ts` writes them. Everything else
kozod knows is built from them:

- **The state** is `replay` in `packages/core/src/state.ts`, which applies every event in order
  through `applyEvent`. An event the state does not allow is a `StateError`, and `EventStore`
  refuses to write it.
- **The index**, `kozo.db`, is what the local API reads. `IndexDb` in
  `packages/daemon/src/index-db.ts` records each event as `EventStore` writes it.

At every start `EventStore.open` reads every log, checks each one's chain and seal, replays the
state and creates the index afresh. A log that fails a check keeps kozod from starting; a last
line a crash cut short is dropped first, the only change kozod makes to a written log.

Files beside the logs are written once and named by events or by the run, and are not rebuilt:
the brief, the run report, the verdicts, the decision log, the evidence, a tool's long output and
the gates' logs. The item files under `items/` are the requests as written; an item's events
carry the SHA-256 of the request each run read.

## Event lines

Every line is one JSON object of `eventSchema` in `packages/core/src/event.ts`. Each carries:

| Field | Holds |
| --- | --- |
| `v` | The event version, `eventVersion` |
| `ts` | When `EventStore` appended it; increasing within a log |
| `seq` | The line's position in its log, from 0 without gaps |
| `prev` | The SHA-256 of the line before in the same log, null on the first |
| `api_call` | The local API write that caused it, null for kozod's own decisions |
| `run_id`, `parent_run` | The run it belongs to and that run's parent; null outside any run |
| `item`, `task` | What it is about; a factory event has no item |
| `node` | The blueprint node that wrote it, if any |
| `cost` | What it added to the run's cost |
| `type`, `data` | What happened, and its fields |

A run's log is sealed when the run ends: `log.sealed`, in the factory's log, records how many
lines it had and the hash of the last. `parseEventLog` and `sealIssues` in
`packages/core/src/event-log.ts` check the chain and the seals.

### Event types

An event that changes state is one `applyEvent` acts on; the others are kept for the record, the
report and the dashboard only (`recordOnlyTypes` in `packages/core/src/state.ts`).
`packages/core/src/docs.test.ts` fails when this table and the schema differ.

| Event | Changes state | Records |
| --- | --- | --- |
| `run.started` | yes | A run began: its agent, model, mode, runtime, the Charter and factory commits it follows and the request it read |
| `session.started` | no | What the worker's agent session started with |
| `run.changed` | yes | A run moved between run states |
| `item.created` | yes | A request became an item, with its repository, source, class and approvals |
| `item.reordered` | yes | A human moved the item in the order |
| `item.edited` | yes | The request changed at its source; an untrusted edit waits for a human |
| `factory.created` | yes | The factory's ID, drawn at its first start |
| `factory.changed` | yes | The factory was paused or resumed |
| `factory.repository` | yes | An applied factory definition named a GitHub repository for the first time |
| `factory.applied` | yes | A factory definition validated and is used by runs that start after |
| `factory.refused` | yes | A factory definition did not validate; the one in use stays |
| `factory.demoted` | yes | kozod lowered a class's autonomy level for its record |
| `factory.pruned` | no | A human pruned closed items' runs to their logs |
| `log.sealed` | yes | A run's log as it ended |
| `stage.changed` | yes | An item or a task moved to another stage |
| `hold.set` | yes | An item or a task was held, and why |
| `hold.cleared` | yes | A hold was cleared |
| `note.added` | yes | An answer, instruction, approval, rejection or check about a task or an item |
| `task.returned` | yes | A human gave back a task they took |
| `plan.proposed` | yes | A drafted plan |
| `plan.accepted` | yes | The plan the item follows |
| `task.defect` | yes | A check on the default branch failed after the task's merge |
| `risk.raised` | yes | kozod raised a task's risk tier from its diff |
| `node.enter` | no | A blueprint node began, deterministic or agent |
| `node.exit` | no | A blueprint node ended, and whether it passed |
| `agent.message` | no | What an agent said |
| `tool.call` | no | A tool call an agent made |
| `guard.denied` | no | A tool call the guard refused before it ran |
| `tool.result` | no | A tool call's output, or the path of a long one |
| `instruction.delivered` | no | An instruction from the queue reached the session |
| `checkpoint` | yes | The task branch's commit at a checkpoint |
| `gates.result` | no | The gates passed, failed or were misconfigured at a level |
| `branch.merged` | yes | A task branch was found in the default branch |
| `handoff.ready` | no | The commit handed to the human after the final verification passed |
| `review.verdict` | no | Review's verdict |
| `external.write` | no | kozod wrote to GitHub or to the owner's files |
| `cost.tick` | no | The run's running cost |

A record-only event still reaches the index: `handoff.ready` fills `handoffs`, `external.write`
fills `external_writes`, and every event is in `events`.

## The index

`kozo.db` is created afresh at every start and by `kozo admin db-rebuild`, so nothing in it is
migrated. `packages/core/src/docs.test.ts` fails when this table and the schema in
`packages/daemon/src/index-db.ts` differ.

| Table | Holds |
| --- | --- |
| `meta` | `schema_version`, `indexSchemaVersion` |
| `items` | Each item's request, stage, the stage it shows, hold, plan and draft |
| `tasks` | Each task's goal, DONE_WHEN, scope, dependencies, stage, hold, retries, checkpoint, whether it awaits a merge and its last failure |
| `handoffs` | Each `handoff.ready`: the task, branch, head and report |
| `external_writes` | Each `external.write`, looked up by item and action, such as the pull request a task opened |
| `holds` | Each hold set, with who set it and why |
| `runs` | Each run's agent, model, state and times |
| `events` | Every event line, by log, item, task, run and time |

## Versioned formats

| Format | Schema | Version |
| --- | --- | --- |
| Event line | `eventSchema` in `packages/core/src/event.ts` | `v`, `eventVersion` |
| Index | `packages/daemon/src/index-db.ts` | `meta.schema_version`, `indexSchemaVersion` |
| `factory.yml` | `packages/core/src/factory.ts` | `version` |
| Charter | `packages/core/src/charter.ts` | `version` |
| Constraints | `packages/core/src/constraints.ts` | `version` |
| Blueprint | `packages/core/src/blueprint.ts` | `version` |
| Automation | `packages/core/src/automation.ts` | `version` |
| Eval case | `packages/core/src/eval-case.ts` | `version` |
| Plan | `packages/core/src/plan.ts` | `version` |
| Brief | `packages/core/src/brief.ts` | `version` |
| Verdict | `packages/core/src/verdict.ts` | `version` |
| Run report | `packages/core/src/run-report.ts` | `version` |
| Item file | `packages/daemon/src/item-file.ts` | `version` in the front matter |
| Worker spec | `workerSpecSchema` in `packages/worker/src/session.ts` | `version` |
| Instruction queue line | `queueLineSchema` in `packages/worker/src/session.ts` | `v` |

The files under a run that carry no version are listed with the other gaps in
[Architecture](architecture.md#design-invariants).

## Changing a format

- **Change the schema in the file above and raise its version** whenever a new reader can no
  longer read an old line, or an old reader would accept a new line and take it to mean
  something else. A new event type, a new optional field or a new value of an enum needs no new
  version: an older kozod refuses the line it does not know instead of misreading it. A version is a `z.literal`, so another version
  is refused on read; kozo never converts an old file.
- **Event lines and item files outlive kozod.** Raising `eventVersion` means existing homes are
  refused: the commit's Impact and the changeset say so and what the user does. Recompute the
  recorded replay under `testing/fixtures/replay-k1`, with its hash chains and seals.
- **The index is rebuilt at every start.** Raise `indexSchemaVersion` with any change to its
  tables; no migration is needed.
- **The worker spec and the queue** are written and read by the same executable, so their
  version guards a kozod and a worker from different builds.
- **The factory definition** is the owner's repository. A version it does not have is refused as
  `factory.refused`, and the definition in use stays.
- A change to the data model is a decision: append it to `docs/decisions.md` first, and the
  user-visible part goes on the site's configuration pages in the same commit.
