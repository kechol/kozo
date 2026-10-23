import { cp, mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import {
  type EvalCase,
  type EvalOutcome,
  type Factory,
  type KozoHome,
  kozoHome,
  parseEvalCase,
  parseReference,
  type Reference,
  sha256,
} from "@kozo/core";
import {
  type Confine,
  charterPath,
  type Definition,
  git,
  type Judge,
  readBaseDocuments,
  runCommand,
  showFile,
  type Verifier,
} from "@kozo/verify";
import { CommandError } from "./api.ts";
import { ControlPlane } from "./control-plane.ts";
import { EventStore } from "./event-store.ts";
import { readItemFile } from "./item-file.ts";
import type { Launcher } from "./launcher.ts";
import { Reconciler } from "./reconcile.ts";
import { Runner } from "./runner.ts";
import { Scheduler } from "./scheduler.ts";
import { takePorts } from "./worktree-ports.ts";
import { taskBranch } from "./worktrees.ts";

/**
 * The registered repository an eval case names: by its path, its `github` name, or the end of
 * its path, as a clone of `owner/name` under a directory of that name.
 */
export function resolveRepository(factory: Factory, name: string): string | null {
  const found = factory.repositories.find(
    (repository) =>
      repository.path === name ||
      repository.github === name ||
      repository.path.endsWith(`/${name}`),
  );
  return found?.path ?? null;
}

/**
 * The eval case of a run's item, drafted from kozod's records: its repository, the commit its
 * first run started from, the request and the outcome it reached. A human adds the hidden tests
 * and checks before committing it.
 */
export async function evalCaseOf(
  home: KozoHome,
  store: EventStore,
  run: string,
): Promise<{ id: string; evalCase: EvalCase }> {
  const state = store.state;
  const item = state.items[state.runs[run]?.item ?? ""];
  if (!item) throw new CommandError(404, `${run} does not exist`);
  const tasks = item.tasks.flatMap((ref) => state.tasks[ref] ?? []);
  const planned = item.plan ?? item.draft;
  const outcome: EvalOutcome | null =
    item.stage === "complete"
      ? "complete"
      : [item.hold, ...tasks.map((task) => task.hold)].some((hold) => hold?.kind === "question")
        ? "question"
        : [item.hold, ...tasks.map((task) => task.hold)].some((hold) => hold?.kind === "attention")
          ? "attention"
          : planned && planned.tasks.length > 1
            ? "split"
            : null;
  if (outcome === null)
    throw new CommandError(409, `${item.ref} has reached no outcome an eval case can expect yet`);
  const start = store.db
    .query<{ start: string }, [string]>(
      "select json_extract(line, '$.data.charter_commit') as start from events where item = ? and type = 'run.started' order by id limit 1",
    )
    .get(item.ref)?.start;
  if (!start) throw new CommandError(409, `${item.ref} has no run to start from`);
  const file = await readItemFile(home, item.ref);
  const merged = tasks.findLast((task) => task.merged?.commit)?.merged?.commit;
  const id = `${basename(item.repository)}-${item.ref}`.toLowerCase().replace(/[^a-z0-9.]+/g, "-");
  return {
    id,
    evalCase: {
      version: 1,
      id,
      repository: item.repository,
      start,
      request: { title: file.title, body: file.body },
      expected: { outcome, ...(merged ? { reference: merged } : {}) },
    },
  };
}

export interface EvalDeps {
  launcher: Launcher;
  judge: Judge;
  verifier: Verifier;
  confine: Confine;
  /** The body of an upstream issue, for a case that names one instead of copying it. */
  issueBody?: (url: string) => Promise<string>;
}

export interface EvalResult {
  id: string;
  expected: EvalOutcome | null;
  outcome: EvalOutcome | "stuck" | "error";
  passed: boolean;
  checks: { command: string; code: number }[];
  costUsd: number;
  /** What the case says the factory must not do, for a human to judge from the run. */
  forbidden: string[];
  error?: string;
}

const owner = [
  "-c",
  "user.name=kozo eval",
  "-c",
  "user.email=eval@example.com",
  "-c",
  "commit.gpgsign=false",
  "-c",
  "core.hooksPath=/dev/null",
];

/** Commits the base's `.kozo/` into a clone whose start commit has none, as a case needs it. */
async function addKozoFiles(source: string, clone: string) {
  const tip = (await git(source, ["rev-parse", "HEAD"])).trim();
  const paths = (await git(source, ["ls-tree", "-r", "--name-only", tip, ".kozo/"]))
    .split("\n")
    .filter(Boolean);
  for (const path of paths) {
    const text = await showFile(source, tip, path);
    if (text !== null) await Bun.write(join(clone, path), text);
  }
  await git(clone, ["add", ".kozo"]);
  await git(clone, [...owner, "commit", "--quiet", "--message", "add kozo's files"]);
}

/**
 * Runs one eval case in a throwaway factory home on a clone of its repository at its start:
 * the factory works the request while kozod plays an owner who approves every start and plan
 * and merges every handoff, until the item completes, waits on a question or for attention,
 * or, when the case expects a split, its plan has more than one task. A complete case then
 * has its hidden tests laid over the merged result, and its prepare and checks run in kozo's
 * command sandbox.
 */
export async function runEvalCase(
  file: string,
  definition: Definition,
  deps: EvalDeps,
  log: (line: string) => void = () => {},
): Promise<EvalResult> {
  const parsed = parseEvalCase(await Bun.file(file).text());
  const failed = (id: string, error: string, expected: EvalOutcome | null = null): EvalResult => ({
    id,
    expected,
    outcome: "error",
    passed: false,
    checks: [],
    costUsd: 0,
    forbidden: [],
    error,
  });
  if (!parsed.ok) return failed(basename(file, ".yml"), parsed.issues.join("; "));
  const evalCase = parsed.value;
  const { expected } = evalCase;
  const source = resolveRepository(definition.factory, evalCase.repository);
  if (source === null)
    return failed(evalCase.id, `${evalCase.repository} is not registered`, expected.outcome);
  let body: string;
  if ("body" in evalCase.request) body = evalCase.request.body;
  else {
    if (!deps.issueBody)
      return failed(evalCase.id, "the case's issue cannot be read", expected.outcome);
    body = await deps.issueBody(evalCase.request.issue);
    if (sha256(body) !== evalCase.request.bodySha256)
      return failed(
        evalCase.id,
        `${evalCase.request.issue} changed since the case was made`,
        expected.outcome,
      );
  }
  const temp = await realpath(await mkdtemp(join(tmpdir(), "kozo-eval-")));
  try {
    const clone = join(temp, basename(source));
    await git(temp, ["clone", "--quiet", "--no-checkout", source, clone]);
    await git(clone, ["checkout", "--quiet", "-B", "main", evalCase.start]);
    await git(clone, ["remote", "remove", "origin"]);
    if ((await showFile(clone, "HEAD", charterPath)) === null) await addKozoFiles(source, clone);
    const home = kozoHome(join(temp, "home"));
    await mkdir(home.root, { recursive: true, mode: 0o700 });
    const store = await EventStore.open(home);
    const inUse = {
      current: {
        ...definition,
        factory: {
          ...definition.factory,
          mode: "local" as const,
          repositories: [{ path: clone }],
          concurrency: 1,
        },
      },
    };
    const runner = new Runner(home, store, {
      launcher: deps.launcher,
      judge: deps.judge,
      verifier: deps.verifier,
      definition: inUse,
      confine: deps.confine,
    });
    const control = new ControlPlane(home, store, inUse, runner);
    const scheduler = new Scheduler(store, runner, inUse, log);
    const reconciler = new Reconciler(store, runner, log, (ref, work) =>
      scheduler.startWork(ref, work),
    );
    try {
      const documents = await readBaseDocuments(clone, "HEAD");
      if (!documents.ok)
        return failed(
          evalCase.id,
          `.kozo/ on ${evalCase.start}: ${documents.problem}`,
          expected.outcome,
        );
      const { constraints } = documents;
      // The services start from the case's start, before any merge brings the agent's code in.
      if (constraints.ports > 0) await takePorts(clone, constraints.ports);
      const env = await runner.envFor(clone);
      for (const command of constraints.services) {
        const code = await runCommand(command, clone, () => {}, env);
        if (code !== 0)
          return failed(evalCase.id, `${command} exited with ${code}`, expected.outcome);
      }
      const { ref } = await control.addItem({
        title: evalCase.request.title,
        body,
        repository: clone,
      });
      const outcome = await drive(
        store,
        control,
        scheduler,
        reconciler,
        clone,
        ref,
        expected.outcome,
      );
      const checks: EvalResult["checks"] = [];
      if (outcome === "complete" && expected.outcome === "complete") {
        await layHiddenTests(evalCase, dirname(file), clone);
        const prepare = expected.prepare ? [expected.prepare] : constraints.prepare;
        const steps = [
          ...prepare.map((command) => ({ command, confined: runner.confined(clone, true) })),
          ...(expected.checks ?? []).map((command) => ({
            command,
            confined: runner.confined(clone),
          })),
        ];
        for (const { command, confined } of steps) {
          const code = await runCommand(command, clone, () => {}, env, confined);
          checks.push({ command, code });
          if (code !== 0) break;
        }
      }
      const costUsd =
        store.db
          .query<{ usd: number }, []>(
            "select coalesce(sum(json_extract(line, '$.cost.usd')), 0) as usd from events",
          )
          .get()?.usd ?? 0;
      return {
        id: evalCase.id,
        expected: expected.outcome,
        outcome,
        passed: outcome === expected.outcome && checks.every((check) => check.code === 0),
        checks,
        costUsd,
        forbidden: expected.forbidden ?? [],
      };
    } finally {
      await scheduler.idle();
      store.close();
    }
  } catch (error) {
    return failed(evalCase.id, (error as Error).message, expected.outcome);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

/** Plays the owner until the item reaches an outcome, or nothing moves any more. */
async function drive(
  store: EventStore,
  control: ControlPlane,
  scheduler: Scheduler,
  reconciler: Reconciler,
  clone: string,
  ref: string,
  expected: EvalOutcome,
): Promise<EvalOutcome | "stuck"> {
  const reference = parseReference(ref) as Reference;
  for (let last = ""; ; ) {
    scheduler.tick();
    await scheduler.idle();
    const state = store.state;
    const item = state.items[ref];
    if (!item) return "stuck";
    const tasks = item.tasks.flatMap((task) => state.tasks[task] ?? []);
    const holds = [item.hold, ...tasks.map((task) => task.hold)];
    if (holds.some((hold) => hold?.kind === "question")) return "question";
    if (holds.some((hold) => hold?.kind === "attention")) return "attention";
    const planned = item.draft ?? item.plan;
    if (expected === "split" && planned && planned.tasks.length > 1) return "split";
    if (item.stage === "complete") return "complete";
    if (item.hold?.kind === "approval") {
      await control.act(ref, reference, "approve", {});
      continue;
    }
    const ready = tasks.filter((task) => task.stage === "handoff" && !task.hold && !task.merged);
    for (const task of ready) {
      const branch = taskBranch(store.factoryId, task.ref);
      await git(clone, [
        ...owner,
        "merge",
        "--quiet",
        "--no-ff",
        "-m",
        `merge ${task.ref}`,
        branch,
      ]);
    }
    if (ready.length > 0) await reconciler.reconcile();
    if (state.lastTs === last && ready.length === 0) return "stuck";
    last = store.state.lastTs ?? "";
  }
}

/** Lays a complete case's hidden tests over the merged result, from a commit or beside the case. */
async function layHiddenTests(evalCase: EvalCase, dir: string, clone: string) {
  const hidden = evalCase.expected.hidden;
  if (!hidden) return;
  if ("commit" in hidden) {
    await git(clone, ["checkout", hidden.commit, "--", ...hidden.paths]);
    return;
  }
  for (const [path, from] of Object.entries(hidden.files)) {
    await mkdir(dirname(join(clone, path)), { recursive: true });
    await cp(join(dir, from), join(clone, path));
  }
}
