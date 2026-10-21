import { type Factory, startBlocker } from "@kozo/core";
import type { EventStore, NewEvent } from "./event-store.ts";
import type { Runner } from "./runner.ts";

/**
 * Starts the work that may start: triage for items in Triage, and the blueprint for tasks in
 * Building, at most `concurrency` at a time and one per item or task. A run that throws holds
 * its item or task for attention with the error.
 */
export class Scheduler {
  private readonly active = new Map<string, Promise<void>>();

  constructor(
    private readonly store: EventStore,
    private readonly runner: Runner,
    private readonly factory: Factory,
    private readonly report: (message: string) => void = () => {},
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
        if (!subject || subject.hold) return;
        const item = target === "item" ? ref : (state.tasks[ref]?.item ?? ref);
        await this.store
          .append({
            type: "hold.set",
            item,
            task: target === "task" ? ref : null,
            data: {
              target,
              hold: "attention",
              reason: `kozod could not run it: ${message}`.slice(0, 2000),
            },
          } as NewEvent)
          .catch(() => {});
      })
      .finally(() => {
        this.active.delete(ref);
        this.tick();
      });
    this.active.set(ref, promise);
  }

  /** Starts whatever may start now. */
  tick(): void {
    const state = this.store.state;
    if (state.paused) return;
    for (const item of Object.values(state.items)) {
      if (this.active.size >= this.factory.concurrency) return;
      if (item.stage !== "triage" || item.hold || this.active.has(item.ref)) continue;
      this.start(item.ref, "item", () => this.runner.triage(item.ref));
    }
    for (const task of Object.values(state.tasks)) {
      if (this.active.size >= this.factory.concurrency) return;
      if (task.stage !== "building" || this.active.has(task.ref)) continue;
      if (startBlocker(state, task) !== null) continue;
      this.start(task.ref, "task", () =>
        this.runner.build(task.ref, "claim", this.lastFailure(task.ref)),
      );
    }
  }

  /** Resolves once nothing runs any more; for tests and for shutting down. */
  async idle(): Promise<void> {
    while (this.active.size > 0) await Promise.allSettled([...this.active.values()]);
  }
}
