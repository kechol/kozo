import {
  type Factory,
  type FactoryState,
  isClosed,
  isRunOver,
  startBlocker,
  type TaskState,
} from "@kozo/core";
import type { EventStore } from "./event-store.ts";
import { costSince } from "./queries.ts";
import { type CharterResult, readCharter } from "./repository.ts";
import { bugfixNodes, type Node, type Runner } from "./runner.ts";

/** The last implement run of a task, the one that carries its blueprint. */
export function lastBlueprintRun(state: FactoryState, task: TaskState) {
  const runs = task.runs.map((ref) => state.runs[ref]).filter((run) => run?.agent === "implement");
  return runs.at(-1) ?? null;
}

/** A task in Handoff whose final verification passed waits for a human to merge it. */
export function awaitingMerge(state: FactoryState, task: TaskState): boolean {
  return task.stage === "handoff" && lastBlueprintRun(state, task)?.state === "succeeded";
}

/**
 * Where a task's next run starts: at the checkpoint of a run that did not finish, so that a
 * lost, stopped or failed run resumes where it was, and otherwise from the claim.
 */
export function resumePoint(state: FactoryState, task: TaskState): Node {
  const last = lastBlueprintRun(state, task);
  // A task sent back to Reviewing after its run finished, by a human's commit, is reviewed again.
  if (task.stage === "reviewing" && last?.state === "succeeded") return "review";
  const node = task.checkpoint?.node as Node | undefined;
  if (
    last &&
    last.state !== "succeeded" &&
    task.checkpoint?.run === last.ref &&
    node &&
    bugfixNodes.includes(node)
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

  constructor(
    private readonly store: EventStore,
    private readonly runner: Runner,
    private readonly factory: Factory,
    private readonly report: (message: string) => void = () => {},
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** The reason the last attempt of a task stopped short, to start the next one with. */
  private lastFailure(task: string): string | null {
    const row = this.store.db
      .query<{ line: string }, [string]>(
        "select line from events where task = ? and type = 'node.exit' order by id desc limit 1",
      )
      .get(task);
    if (!row) return null;
    const event = JSON.parse(row.line) as { data: { ok: boolean; summary?: string } };
    return event.data.ok ? null : (event.data.summary ?? null);
  }

  private start(ref: string, target: "item" | "task", work: () => Promise<void>) {
    const promise = work()
      .catch(async (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        this.report(`kozod: ${ref}: ${message}`);
        const state = this.store.state;
        const subject = target === "item" ? state.items[ref] : state.tasks[ref];
        if (!subject || subject.hold || isClosed(subject.stage)) return;
        const item = target === "item" ? ref : (state.tasks[ref]?.item ?? ref);
        await this.store
          .append({
            type: "hold.set",
            item,
            task: target === "task" ? ref : null,
            data: {
              target,
              hold: "attention",
              by: "kozod",
              reason: `kozod could not run it: ${message}`.slice(0, 2000),
            },
          })
          .catch(() => {});
      })
      .finally(() => {
        this.active.delete(ref);
        this.tick();
      });
    this.active.set(ref, promise);
  }

  /** Why nothing new may start in this repository now, or null when work may start. */
  private capacity(repository: string, result: CharterResult): string | null {
    if (!result.ok) return `the Charter keeps the repository from running: ${result.reason}`;
    const { charter } = result;
    const midnight = this.now();
    midnight.setHours(0, 0, 0, 0);
    const spent = costSince(this.store.db, midnight);
    if (spent >= this.factory.budget.daily_usd) {
      return `the daily budget of ${this.factory.budget.daily_usd} USD is spent`;
    }
    const state = this.store.state;
    const tasks = Object.values(state.tasks).filter(
      (task) => state.items[task.item]?.repository === repository,
    );
    const waiting = tasks.filter((task) => awaitingMerge(state, task) && !task.hold).length;
    if (waiting >= charter.backpressure.max_awaiting_merge) {
      return `${waiting} tasks await a merge, the Charter's limit`;
    }
    const held = [
      ...Object.values(state.items).filter((item) => item.repository === repository),
      ...tasks,
    ].filter(
      (subject) => subject.hold?.kind === "question" || subject.hold?.kind === "attention",
    ).length;
    if (held >= charter.backpressure.max_held)
      return `${held} items and tasks wait on questions or attention, the Charter's limit`;
    return null;
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
    if (state.paused) return;
    // Holds for capacity do not count toward the Charter's limits, so one look per repository
    // serves the whole pass.
    const stops = new Map<string, string | null>();
    const stopOf = async (repository: string) => {
      if (!stops.has(repository)) {
        const result = await readCharter(repository).catch(
          (error: Error): CharterResult => ({ ok: false, reason: error.message }),
        );
        stops.set(repository, this.capacity(repository, result));
      }
      return stops.get(repository) ?? null;
    };

    for (const task of Object.values(this.store.state.tasks)) {
      if (task.hold?.kind !== "capacity" || this.active.has(task.ref)) continue;
      const repository = this.store.state.items[task.item]?.repository ?? "";
      if ((await stopOf(repository)) !== null) continue;
      await this.store.append({
        type: "hold.cleared",
        item: task.item,
        task: task.ref,
        data: { target: "task", hold: "capacity", by: "kozod" },
      });
    }

    for (const item of Object.values(this.store.state.items)) {
      if (this.active.size >= this.factory.concurrency) return;
      if (item.stage !== "triage" || item.hold || this.active.has(item.ref)) continue;
      if ((await stopOf(item.repository)) !== null) continue;
      this.start(item.ref, "item", () => this.runner.triage(item.ref));
    }
    for (const task of Object.values(this.store.state.tasks)) {
      if (this.active.size >= this.factory.concurrency) return;
      if (!this.needsRun(task)) continue;
      const repository = this.store.state.items[task.item]?.repository ?? "";
      const stop = await stopOf(repository);
      if (stop !== null) {
        await this.store.append({
          type: "hold.set",
          item: task.item,
          task: task.ref,
          data: { target: "task", hold: "capacity", by: "kozod", reason: stop },
        });
        continue;
      }
      const from = resumePoint(this.store.state, task);
      this.start(task.ref, "task", () =>
        this.runner.build(task.ref, from, this.lastFailure(task.ref)),
      );
    }
  }

  /**
   * Starts other work for a task, such as the check at Complete, within the same concurrency as
   * runs, since it runs the repository's tests too. Returns false when it cannot start now.
   */
  startWork(ref: string, work: () => Promise<void>): boolean {
    if (this.active.has(ref) || this.active.size >= this.factory.concurrency) return false;
    this.start(ref, "task", work);
    return true;
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

  /** Resolves once nothing runs or schedules any more; for tests and for shutting down. */
  async idle(): Promise<void> {
    while (this.ticking || this.active.size > 0) {
      await this.ticking;
      await Promise.allSettled([...this.active.values()]);
    }
  }
}
