import {
  awaitingMerge,
  blueprintNodes,
  type Factory,
  type FactoryState,
  inOrder,
  isClosed,
  isRunOver,
  lastBlueprintRun,
  startBlocker,
  type TaskState,
  waitsOnOwner,
} from "@kozo/core";
import type { DefinitionInUse } from "./definition.ts";
import type { EventStore } from "./event-store.ts";
import { costToday, lastFailure } from "./queries.ts";
import { type CharterResult, readCharter } from "./repository.ts";
import type { Runner } from "./runner.ts";
import type { Node } from "./task-run.ts";
import { clearHold, hold } from "./transitions.ts";

/**
 * Where a task's next run starts: at verify-deterministic for a task a human gave back, at the
 * checkpoint of a run that did not finish, so that a lost, stopped or failed run resumes where it
 * was, and otherwise from the claim.
 */
export function resumePoint(state: FactoryState, task: TaskState): Node {
  // A task a human took and gave back goes through every check after implement.
  if (task.returned) return "verify-deterministic";
  const last = lastBlueprintRun(state, task);
  // A task sent back to Reviewing after its run finished, by a human's commit, is reviewed again.
  if (task.stage === "reviewing" && last?.state === "succeeded") return "review";
  const node = task.checkpoint?.node as Node | undefined;
  if (
    last &&
    last.state !== "succeeded" &&
    task.checkpoint?.run === last.ref &&
    node &&
    blueprintNodes.includes(node)
  ) {
    return node;
  }
  return "claim";
}

/**
 * Starts the work that may start: triage for items in Triage, and the blueprint for tasks
 * that need a run, at most `concurrency` at a time and one per item or task. The daily budget
 * and each repository's backpressure stop new starts; the tasks they stop wait with a capacity
 * hold that kozod clears once the condition ends. A run that throws holds its item or task for
 * attention with the error.
 */
export class Scheduler {
  private readonly active = new Map<string, Promise<void>>();
  private ticking: Promise<void> | null = null;
  private again = false;
  private stopped = false;

  constructor(
    private readonly store: EventStore,
    private readonly runner: Runner,
    private readonly definition: DefinitionInUse,
    private readonly report: (message: string) => void = () => {},
    private readonly now: () => Date = () => new Date(),
  ) {}

  private factory(): Factory {
    return this.definition.current.factory;
  }

  /** The reason the last attempt of a task stopped short, to start the next one with. */
  private lastFailure(task: string): string | null {
    return lastFailure(this.store.db, task);
  }

  /**
   * Starts work for an item or a task, which holds back `reserveUsd` of the daily budget, its
   * repository's session limit, from the moment it starts until it ends.
   */
  private start(
    ref: string,
    target: "item" | "task",
    work: () => Promise<void>,
    reserveUsd: number,
  ) {
    const release = this.runner.reserve(reserveUsd);
    const promise = work()
      .catch(async (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        this.report(`kozod: ${ref}: ${message}`);
        const state = this.store.state;
        const subject = target === "item" ? state.items[ref] : state.tasks[ref];
        if (!subject || subject.hold || isClosed(subject.stage)) return;
        const item = target === "item" ? ref : (state.tasks[ref]?.item ?? ref);
        await hold(
          this.store,
          { item, task: target === "task" ? ref : null },
          "attention",
          `kozod could not run it: ${message}`,
        ).catch(() => {});
      })
      .finally(() => {
        release();
        this.active.delete(ref);
        this.tick();
      });
    this.active.set(ref, promise);
  }

  /**
   * Why nothing new may start in this repository now, or null when work may start. The work
   * running now holds back its sessions' limits from the budget, so that concurrent sessions
   * cannot spend past it.
   */
  private capacity(repository: string, result: CharterResult): string | null {
    if (!result.ok) return `the Charter keeps the repository from running: ${result.reason}`;
    const { charter } = result;
    const budget = this.factory().budget.daily_usd;
    const spent = costToday(this.store.db, this.now());
    if (spent >= budget) return `the daily budget of ${budget} USD is spent`;
    if (spent + this.runner.reservedUsd >= budget)
      return `the daily budget of ${budget} USD is spent or held back by the work running now`;
    const state = this.store.state;
    const tasks = Object.values(state.tasks).filter(
      (task) => state.items[task.item]?.repository === repository,
    );
    const waiting = tasks.filter((task) => awaitingMerge(state, task)).length;
    if (waiting >= charter.backpressure.max_awaiting_merge) {
      return `${waiting} tasks await a merge, the Charter's limit`;
    }
    const held = [
      ...Object.values(state.items).filter((item) => item.repository === repository),
      ...tasks,
    ].filter((subject) => waitsOnOwner(subject.hold)).length;
    if (held >= charter.backpressure.max_held)
      return `${held} items and tasks wait on questions or attention, the Charter's limit`;
    return null;
  }

  /**
   * Holds each open task whose dependencies are not all complete, and clears the hold once they
   * are. A cancelled dependency never completes, so its dependents are held for attention.
   */
  private async holdForDependencies() {
    for (const task of Object.values(this.store.state.tasks)) {
      if (isClosed(task.stage)) continue;
      const state = this.store.state;
      const open = task.depends_on.filter((ref) => state.tasks[ref]?.stage !== "complete");
      const cancelled = open.filter((ref) => state.tasks[ref]?.stage === "cancelled");
      const subject = { item: task.item, task: task.ref };
      // Looking at the state first keeps tasks already as asked out of the store's queue.
      if ((open.length === 0 || cancelled.length > 0) && task.hold?.kind === "dependency")
        await clearHold(this.store, subject, { kind: "dependency" });
      if (open.length === 0 || this.store.state.tasks[task.ref]?.hold) continue;
      if (cancelled.length > 0) {
        await hold(
          this.store,
          subject,
          "attention",
          `${cancelled.join(", ")} was cancelled, so ${task.ref} cannot start; close it or plan it again`,
        );
      } else {
        await hold(this.store, subject, "dependency", `waits for ${open.join(", ")} to complete`);
      }
    }
  }

  /** Whether a task needs a run: it is in Building, or a run of its blueprint did not finish. */
  private needsRun(task: TaskState): boolean {
    const state = this.store.state;
    if (task.hold || isClosed(task.stage) || this.active.has(task.ref)) return false;
    if (startBlocker(state, task) !== null) return false;
    const last = lastBlueprintRun(state, task);
    if (task.stage === "building" || task.stage === "reviewing") {
      return last === null || isRunOver(last.state);
    }
    return last !== null && isRunOver(last.state) && last.state !== "succeeded";
  }

  private async plan(): Promise<void> {
    const state = this.store.state;
    if (state.paused || this.stopped) return;
    // One read of each Charter serves the whole pass; the capacity is looked at each time,
    // since the work started in this pass holds back budget.
    const charters = new Map<string, CharterResult>();
    const charterOf = async (repository: string) => {
      let result = charters.get(repository);
      if (!result) {
        result = await readCharter(repository, this.factory().mode, this.store.state).catch(
          (error: Error): CharterResult => ({ ok: false, reason: error.message }),
        );
        charters.set(repository, result);
      }
      return result;
    };
    const stopOf = async (repository: string) =>
      this.capacity(repository, await charterOf(repository));
    const limitOf = async (repository: string) => {
      const result = await charterOf(repository);
      return result.ok ? result.charter.limits.max_cost_usd : 0;
    };

    for (const task of Object.values(this.store.state.tasks)) {
      if (task.hold?.kind !== "capacity" || this.active.has(task.ref)) continue;
      const repository = this.store.state.items[task.item]?.repository ?? "";
      if ((await stopOf(repository)) !== null) continue;
      await clearHold(this.store, { item: task.item, task: task.ref }, { kind: "capacity" });
    }

    await this.holdForDependencies();

    // A merged task's check comes first: it completes items and lets dependent tasks start, and
    // new work would otherwise take every slot it could start in. Then work starts in item order.
    const ordered = inOrder(this.store.state);
    for (const task of ordered.tasks) {
      if (this.active.size >= this.factory().concurrency) return;
      if (!task.merged || task.stage !== "handoff" || task.hold || this.active.has(task.ref))
        continue;
      // The check runs the gates and no session.
      this.start(task.ref, "task", () => this.runner.complete(task.ref), 0);
    }
    for (const { ref } of ordered.items) {
      const item = this.store.state.items[ref];
      if (this.active.size >= this.factory().concurrency) return;
      if (!item || item.hold || this.active.has(item.ref)) continue;
      // An item in Planning without a hold had its plan rejected or its question answered, or is
      // a feature whose acceptance criteria the plan agent works out first.
      const draft =
        item.stage === "triage"
          ? () => this.runner.triage(item.ref)
          : item.stage === "planning" && item.draft
            ? () => this.runner.replan(item.ref)
            : null;
      if (!draft || (await stopOf(item.repository)) !== null) continue;
      this.start(item.ref, "item", draft, await limitOf(item.repository));
    }
    for (const { ref } of ordered.tasks) {
      const task = this.store.state.tasks[ref];
      if (this.active.size >= this.factory().concurrency) return;
      if (!task || !this.needsRun(task)) continue;
      const repository = this.store.state.items[task.item]?.repository ?? "";
      const stop = await stopOf(repository);
      if (stop !== null) {
        await hold(this.store, { item: task.item, task: task.ref }, "capacity", stop);
        continue;
      }
      const from = resumePoint(this.store.state, task);
      this.start(
        task.ref,
        "task",
        () => this.runner.build(task.ref, from, this.lastFailure(task.ref)),
        await limitOf(repository),
      );
    }
  }

  /**
   * Starts other work for a task that runs no session, such as the check at Complete, within the
   * same concurrency as runs, since it runs the repository's tests too. Returns false when it cannot start now.
   */
  startWork(ref: string, work: () => Promise<void>): boolean {
    if (this.stopped || this.active.has(ref) || this.active.size >= this.factory().concurrency)
      return false;
    this.start(ref, "task", work, 0);
    return true;
  }

  /** Resolves once the look for work running now, and any folded into it, has ended. */
  async planned(): Promise<void> {
    while (this.ticking) await this.ticking;
  }

  /** Looks for work to start; calls while one look is running are folded into one more. */
  tick(): void {
    if (this.ticking) {
      this.again = true;
      return;
    }
    this.ticking = this.plan()
      .catch((error: unknown) => this.report(`kozod: scheduling failed: ${String(error)}`))
      .finally(() => {
        this.ticking = null;
        if (this.again) {
          this.again = false;
          this.tick();
        }
      });
  }

  /** Starts nothing new from now on, and resolves once the work running now has ended. */
  async stop(): Promise<void> {
    this.stopped = true;
    await this.idle();
  }

  /** Resolves once nothing runs or schedules any more; for tests and for shutting down. */
  async idle(): Promise<void> {
    while (this.ticking || this.active.size > 0) {
      await this.ticking;
      await Promise.allSettled([...this.active.values()]);
    }
  }
}
