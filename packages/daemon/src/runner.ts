import {
  type BlockedReason,
  blueprintNodes,
  demotedCharter,
  isClosed,
  type KozoHome,
  runFiles,
  type Stage,
  type TaskState,
} from "@kozo/core";
import {
  baseOf,
  CommandStopped,
  type Confine,
  git,
  globMatcher,
  type Judge,
  listFiles,
  readBaseDocuments,
  type Verifier,
} from "@kozo/verify";
import { CommandEnvironment } from "./command-env.ts";
import { completeTask } from "./completion.ts";
import type { DefinitionInUse } from "./definition.ts";
import { draftItem } from "./drafting.ts";
import type { EgressProxy } from "./egress.ts";
import type { EventStore } from "./event-store.ts";
import { askExplorer } from "./explorer.ts";
import { writeHandoffReport } from "./handoff-report.ts";
import type { Launcher } from "./launcher.ts";
import { nodeSteps } from "./nodes.ts";
import { RunRecords } from "./run-records.ts";
import {
  BlueprintRun,
  type Node,
  type Repository,
  type RunEnd,
  type RunnerOps,
} from "./task-run.ts";
import { clearHold, hold, move } from "./transitions.ts";
import { releaseTask } from "./worktrees.ts";

export interface RunnerDeps {
  launcher: Launcher;
  /** kozod's API port, which no command it confines may reach. */
  apiPort?: number;
  judge: Judge;
  verifier: Verifier;
  /** The factory definition; a run reads it once, when it starts. */
  definition: DefinitionInUse;
  /** Confines the diff's commands in prepare, the gates and prove to the task's sandbox. */
  confine: Confine;
  /**
   * The commit services may run at, for an eval whose merges no human read; otherwise the tip
   * of the default branch, which only a human merges into.
   */
  trustedBase?: string;
  /** kozod's egress proxy, prepare's only way out; without it prepare reaches any host. */
  egress?: Pick<EgressProxy, "issue" | "port">;
}

/** Thrown when the repository's documents keep a run from starting at all. */
export class RunnerError extends Error {}

/**
 * Runs the agent nodes of the factory and the deterministic nodes around them: triage for an
 * item, and the bugfix blueprint for a task from Building to Handoff. Every node is entered at
 * a checkpoint, and every retry starts a new run with a new session. The Runner holds the
 * blueprint loop and puts the rest behind RunnerOps: drafting, the check at Complete, the
 * explorer, the handoff report, the run records and the command environment.
 */
export class Runner implements RunnerOps {
  readonly records: RunRecords;
  readonly commands: CommandEnvironment;

  constructor(
    readonly home: KozoHome,
    readonly store: EventStore,
    readonly deps: RunnerDeps,
  ) {
    this.records = new RunRecords(home, store, deps.launcher);
    this.commands = new CommandEnvironment(home, store, deps);
  }

  get reservedUsd(): number {
    return this.records.reservedUsd;
  }

  reserve(usd: number): () => void {
    return this.records.reserve(usd);
  }

  prepare(...args: Parameters<CommandEnvironment["prepare"]>) {
    return this.commands.prepare(...args);
  }

  envFor(worktree: string) {
    return this.commands.envFor(worktree);
  }

  confined(worktree: string, prepare = false) {
    return this.commands.confined(worktree, prepare);
  }

  recordedGates(...args: Parameters<CommandEnvironment["recordedGates"]>) {
    return this.commands.recordedGates(...args);
  }

  stop() {
    this.records.stop();
  }

  stopWork(ref: string) {
    return this.records.stopWork(ref);
  }

  sessionFor(ref: string) {
    return this.records.sessionFor(ref);
  }

  startRun(...args: Parameters<RunRecords["startRun"]>) {
    return this.records.startRun(...args);
  }

  endRun(...args: Parameters<RunRecords["endRun"]>) {
    return this.records.endRun(...args);
  }

  failOpenRuns(ref: string, error: unknown) {
    return this.records.failOpenRuns(ref, error);
  }

  session(...args: Parameters<RunRecords["session"]>) {
    return this.records.session(...args);
  }

  async repository(path: string): Promise<Repository> {
    const { branch, base, ref } = await baseOf(path, this.deps.definition.current.factory.mode);
    const tip = (await git(path, ["rev-parse", ref])).trim();
    const documents = await readBaseDocuments(path, tip);
    if (!documents.ok) {
      throw new RunnerError(
        `${path} on ${branch}: ${documents.problem} ${documents.issues.join("; ")}`.trim(),
      );
    }
    return {
      path,
      branch,
      base,
      ref,
      tip,
      charter: demotedCharter(this.store.state, path, documents.charter, documents.charterSha),
      constraints: documents.constraints,
    };
  }

  // --- Triage ---------------------------------------------------------------------------------

  /**
   * Triage: investigates the item in a read-only checkout of the default branch and records the
   * plan it drafts, or holds the item with the question that blocks it. Plan needed? then sends
   * the draft for approval in Planning, or accepts it as it is.
   */
  async triage(itemRef: string): Promise<void> {
    const item = this.store.state.items[itemRef];
    if (item?.stage !== "triage" || item.hold) return;
    await draftItem(this, itemRef, "triage");
  }

  /**
   * Planning without a hold: the plan agent drafts the plan again from the current draft and the
   * owner's notes, after a rejection, an answer, or triage's draft of a feature, whose acceptance
   * criteria it works out with the owner, and the new draft waits for approval.
   */
  async replan(itemRef: string): Promise<void> {
    const item = this.store.state.items[itemRef];
    if (item?.stage !== "planning" || item.hold || !item.draft) return;
    await draftItem(this, itemRef, "plan");
  }

  /** Holds the task, or the item when `task` is null, unless it is held already. */
  async hold(
    item: string,
    task: string | null,
    kind: "question" | "attention",
    reason: string,
    run?: string,
    blocked?: BlockedReason,
  ) {
    await hold(this.store, { item, task }, kind, reason, { run, blocked });
  }

  async moveTask(task: TaskState, to: Stage, run: string | null, reason: string) {
    await move(this.store, { item: task.item, task: task.ref }, to, reason, {
      ...(run ? { run } : {}),
    });
  }

  // --- Building to Handoff --------------------------------------------------------------------

  /**
   * Runs the bugfix blueprint for a task from `start` on. Each attempt at the change is a run
   * of its own with a new session; a failed deterministic check starts the next attempt with
   * the failure summarized, until the attempts run out.
   */
  async build(
    taskRef: string,
    start: Node = "claim",
    failure: string | null = null,
  ): Promise<void> {
    await this.records.track(taskRef, (signal) => this.attempts(taskRef, start, failure, signal));
  }

  private async attempts(
    taskRef: string,
    start: Node,
    failure: string | null,
    signal: AbortSignal,
  ): Promise<void> {
    let from: Node = start;
    let previous = failure;
    for (let attempts = 1; ; attempts += 1) {
      const outcome = await this.runNodes(taskRef, from, previous, signal).catch(
        async (error: unknown) => {
          await this.failOpenRuns(taskRef, error);
          throw error;
        },
      );
      if (outcome.kind !== "retry") return;
      if (attempts >= outcome.rounds) {
        await this.hold(
          this.store.state.tasks[taskRef]?.item ?? "",
          taskRef,
          "attention",
          `no progress after ${attempts} attempts: ${outcome.failure}`,
        );
        return;
      }
      from = "brief";
      previous = outcome.failure;
    }
  }

  private async runNodes(
    taskRef: string,
    start: Node,
    failure: string | null,
    signal: AbortSignal,
  ): Promise<RunEnd> {
    const task = this.store.state.tasks[taskRef];
    const item = task ? this.store.state.items[task.item] : undefined;
    if (!task || !item?.plan || task.hold) return { kind: "done" };
    const repository = await this.repository(item.repository);
    const { charter, constraints } = repository;
    const definition = this.deps.definition.current;
    const run = await this.startRun(
      { item: item.ref, task: taskRef },
      "implement",
      repository.tip,
      definition,
    );
    // Computed for every run, wherever it starts: the guard and the sandbox protect these.
    const listed = await listFiles(repository.path, repository.tip);
    const existingTests = charter.existing_tests_protected
      ? listed.filter(globMatcher(constraints.tests))
      : [];
    const blueprintRun = new BlueprintRun(this, {
      task,
      item: { ...item, plan: item.plan },
      repository,
      definition,
      run,
      listed,
      existingTests,
      failure,
      signal,
    });
    const stopReason = (task: TaskState | undefined) =>
      !task || isClosed(task.stage)
        ? "the task is closed"
        : task.hold
          ? "the task is held"
          : this.records.stopping
            ? "kozod stopped"
            : "a human stopped it";

    // Every node runs: verify-app decides from the risk tier, which a blueprint never lowers.
    for (const node of blueprintNodes.slice(blueprintNodes.indexOf(start))) {
      const current = this.store.state.tasks[taskRef];
      if (!current || isClosed(current.stage))
        return await blueprintRun.stopHere("stopped", stopReason(current));
      if (current.hold || this.records.stopping || signal.aborted) {
        // The next run resumes at this node, not at the one that finished before the stop.
        await blueprintRun.checkpoint(node);
        return await blueprintRun.stopHere("stopped", stopReason(current));
      }
      try {
        const ended = await nodeSteps[node](blueprintRun, current);
        if (ended) return ended;
      } catch (error) {
        if (!(error instanceof CommandStopped)) throw error;
        const now = this.store.state.tasks[taskRef];
        if (now && !isClosed(now.stage)) await blueprintRun.checkpoint(node);
        return await blueprintRun.stopHere("stopped", stopReason(now));
      }
    }
    return await blueprintRun.stopHere("succeeded");
  }

  /** The brief of the task's last implement run before `run`, for a run that resumes at implement. */
  async lastBrief(task: TaskState, run: string): Promise<string> {
    for (const ref of [...task.runs].reverse()) {
      if (ref === run || this.store.state.runs[ref]?.agent !== "implement") continue;
      const file = Bun.file(runFiles(this.home, ref).brief);
      if (await file.exists()) return await file.text();
    }
    throw new RunnerError(`${task.ref} has no brief to resume its implement node with`);
  }

  async refs(repository: string, branch: string): Promise<Map<string, string>> {
    const listed = await git(repository, ["for-each-ref", "--format=%(refname) %(objectname)"]);
    return new Map(
      listed
        .split("\n")
        .filter(Boolean)
        .map((line) => line.split(" ") as [string, string])
        .filter(([ref]) => ref !== `refs/heads/${branch}`),
    );
  }

  /** The refs other than the task branch that a run created, moved or deleted. */
  async refsChanged(repository: string, branch: string, before: Map<string, string>) {
    const after = await this.refs(repository, branch);
    const changed = new Set<string>();
    for (const [ref, sha] of after) if (before.get(ref) !== sha) changed.add(ref);
    for (const ref of before.keys()) if (!after.has(ref)) changed.add(ref);
    return [...changed];
  }

  async writeHandoffReport(
    itemRef: string,
    task: TaskState,
    base: string,
    worktree: string,
    reproduce: boolean,
  ) {
    await writeHandoffReport(this, itemRef, task, base, worktree, reproduce);
  }

  async complete(taskRef: string): Promise<void> {
    await completeTask(this, taskRef);
  }

  async ask(itemRef: string, taskRef: string | null, question: string): Promise<string> {
    return await askExplorer(this, itemRef, taskRef, question);
  }

  /**
   * Splits an item again after an implement session found its task cannot be done within its
   * scope: the task and every open task that depends on it are cancelled and released, and the
   * item goes back to Planning with its current plan as the draft, where the plan agent splits
   * the remaining work. Finished tasks, and open ones that do not depend on the stopped task,
   * stay.
   */
  async splitAgain(taskRef: string, question: string) {
    const state = this.store.state;
    const item = state.items[state.tasks[taskRef]?.item ?? ""];
    if (!item?.plan) return;
    const stopped = new Set([taskRef]);
    for (let grew = true; grew; ) {
      grew = false;
      for (const ref of item.tasks) {
        const task = state.tasks[ref];
        if (!task || stopped.has(ref) || isClosed(task.stage)) continue;
        if (task.depends_on.some((dependency) => stopped.has(dependency))) {
          stopped.add(ref);
          grew = true;
        }
      }
    }
    const reason = `${taskRef} cannot be done within its scope, so the item is split again: ${question}`;
    for (const ref of stopped) {
      if (ref !== taskRef) void this.stopWork(ref);
      const task = this.store.state.tasks[ref];
      if (!task) continue;
      await clearHold(this.store, { item: item.ref, task: ref });
      await this.moveTask(task, "cancelled", null, reason);
      await this.release(ref, true);
    }
    // A second block while the item is already back in Planning only cancels its own tasks;
    // the plan agent sees them among the tasks so far.
    if (this.store.state.items[item.ref]?.stage !== "building") return;
    await this.store.append({ type: "plan.proposed", item: item.ref, data: { plan: item.plan } });
    await move(this.store, { item: item.ref, task: null }, "planning", reason);
  }

  /** Removes a closed task's worktree, and its branch when `deleteBranch`. */
  async release(taskRef: string, deleteBranch: boolean) {
    const task = this.store.state.tasks[taskRef];
    const item = task ? this.store.state.items[task.item] : undefined;
    if (!item) return;
    await releaseTask(this.home, item.repository, taskRef, {
      factory: this.store.factoryId,
      deleteBranch,
    });
  }
}
