import type { Event, EventType } from "@kozo/core";

type Data<T extends EventType> = Extract<Event, { type: T }>["data"];
type Envelope = Partial<Pick<Event, "run_id" | "parent_run" | "item" | "task" | "node">>;

/**
 * Builds events as kozod would write them: strictly increasing `ts`, one millisecond apart,
 * and `seq` counted per log, the run's own or kozod's for events outside a run.
 */
export function eventWriter(start = "2026-10-21T09:00:00.000Z") {
  let clock = Date.parse(start);
  const seqs = new Map<string | null, number>();
  return <T extends EventType>(type: T, data: Data<T>, envelope: Envelope = {}): Event => {
    const run = envelope.run_id ?? null;
    const seq = seqs.get(run) ?? 0;
    seqs.set(run, seq + 1);
    const ts = new Date(clock).toISOString();
    clock += 1;
    return {
      v: 1,
      ts,
      run_id: run,
      parent_run: envelope.parent_run ?? null,
      item: envelope.item === undefined ? null : envelope.item,
      task: envelope.task ?? null,
      seq,
      node: envelope.node ?? null,
      cost: { usd: 0, in: 0, out: 0, cache_read: 0 },
      type,
      data,
    } as Event;
  };
}
