import { mkdir, open, readdir } from "node:fs/promises";
import { dirname, relative } from "node:path";
import {
  applyEvent,
  type Event,
  type EventLog,
  type EventType,
  eventSchema,
  type FactoryState,
  formatReference,
  isRunOver,
  type KozoHome,
  lineHash,
  mergeLogs,
  parseEventLog,
  parseReference,
  replay,
  runFiles,
  sealIssues,
} from "@kozo/core";
import { IndexDb } from "./index-db.ts";

type Data<T extends EventType> = Extract<Event, { type: T }>["data"];

/** An event as kozod hands it to the store, which adds `v`, `ts`, `seq` and the defaults. */
export type NewEvent = {
  [T in EventType]: {
    type: T;
    data: Data<T>;
    run_id?: string | null;
    parent_run?: string | null;
    item?: string | null;
    task?: string | null;
    node?: string | null;
    cost?: Event["cost"];
  };
}[EventType];

export type Listener = (event: Event, id: number) => void;

/** A log or state problem found while opening a home; kozod does not start on one. */
export class EventLogError extends Error {}

async function readLogs(home: KozoHome): Promise<EventLog[]> {
  const paths = [home.eventsLog];
  const runs = await readdir(home.runs).catch(() => []);
  for (const run of runs.sort()) paths.push(runFiles(home, run).events);
  const logs: EventLog[] = [];
  for (const path of paths) {
    const file = Bun.file(path);
    if (!(await file.exists())) continue;
    const result = parseEventLog(await file.text(), relative(home.root, path));
    if (!result.ok) throw new EventLogError(result.issues.join("\n"));
    logs.push(result.value);
  }
  const issues = sealIssues(logs);
  if (issues.length > 0) throw new EventLogError(issues.join("\n"));
  return logs;
}

/**
 * The record plane of one factory. It is the only writer of the event logs and of the index:
 * appending stamps the event, applies it to the replayed state, then writes and syncs the line
 * and updates the index, one event at a time. The end of a run also seals its log.
 */
export class EventStore {
  private current: FactoryState;
  private index: IndexDb;
  /** The next `seq` and the `prev` hash of each log, by run, with "" for kozod's own. */
  private readonly logs = new Map<string, { seq: number; last: string | null }>();
  private lastMs: number;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly listeners = new Set<Listener>();
  private lastRun = 0;
  private lastItem = 0;

  private constructor(
    readonly home: KozoHome,
    state: FactoryState,
    index: IndexDb,
  ) {
    this.current = state;
    this.index = index;
    this.lastMs = state.lastTs === null ? 0 : Date.parse(state.lastTs);
  }

  /** Replays every log under the home and rebuilds the index from them. */
  static async open(home: KozoHome): Promise<EventStore> {
    await mkdir(home.runs, { recursive: true });
    const logs = await readLogs(home);
    const events = mergeLogs(logs.map((log) => log.events));
    let state: FactoryState;
    try {
      state = replay(events);
    } catch (error) {
      throw new EventLogError(`the event logs do not replay: ${(error as Error).message}`);
    }
    const store = new EventStore(home, state, IndexDb.create(home.db));
    for (const log of logs) {
      const end = log.events.at(-1);
      if (end) store.logs.set(end.run_id ?? "", { seq: end.seq + 1, last: log.last });
    }
    store.fillIndex(events);
    // A run that ended just before kozod stopped may not have its seal yet.
    for (const run of Object.values(state.runs)) {
      if (isRunOver(run.state) && !run.sealed) await store.serial(() => store.seal(run.ref));
    }
    return store;
  }

  get state(): Readonly<FactoryState> {
    return this.current;
  }

  get db() {
    return this.index.db;
  }

  /** Drops the index and builds it again from the logs. */
  async rebuildIndex(): Promise<void> {
    await this.serial(async () => {
      this.index.close();
      this.index = IndexDb.create(this.home.db);
      this.fillIndex(mergeLogs((await readLogs(this.home)).map((log) => log.events)));
    });
  }

  private fillIndex(events: Event[]) {
    const state = replay([]);
    for (const event of events) {
      applyEvent(state, event);
      this.index.record(event, state);
    }
  }

  /**
   * Appends one event, and the seal of its run's log when it ends the run. An event that the
   * schema or the state refuses throws and is neither written nor applied.
   */
  append(event: NewEvent): Promise<Event> {
    return this.serial(async () => {
      const line = await this.write(event);
      if (line.type === "run.changed" && isRunOver(line.data.to) && line.run_id !== null) {
        await this.seal(line.run_id);
      }
      return line;
    });
  }

  private async seal(run: string) {
    const info = this.current.runs[run];
    const log = this.logs.get(run);
    if (!info || !log?.last) return;
    await this.write({
      type: "log.sealed",
      item: info.item,
      task: info.task,
      data: { run, lines: log.seq, last: log.last },
    });
  }

  private async write(event: NewEvent): Promise<Event> {
    const log = event.run_id ?? "";
    const now = Math.max(Date.now(), this.lastMs + 1);
    const line = eventSchema.parse({
      v: 1,
      ts: new Date(now).toISOString(),
      prev: this.logs.get(log)?.last ?? null,
      run_id: event.run_id ?? null,
      parent_run: event.parent_run ?? null,
      item: event.item ?? null,
      task: event.task ?? null,
      seq: this.logs.get(log)?.seq ?? 0,
      node: event.node ?? null,
      cost: event.cost ?? { usd: 0, in: 0, out: 0, cache_read: 0 },
      type: event.type,
      data: event.data,
    });
    const next = structuredClone(this.current);
    applyEvent(next, line);
    const path =
      line.run_id === null ? this.home.eventsLog : runFiles(this.home, line.run_id).events;
    const text = JSON.stringify(line);
    await mkdir(dirname(path), { recursive: true });
    const file = await open(path, "a");
    try {
      await file.write(`${text}\n`);
      await file.sync();
    } finally {
      await file.close();
    }
    this.current = next;
    this.lastMs = now;
    this.logs.set(log, { seq: line.seq + 1, last: lineHash(text) });
    const id = this.index.record(line, next);
    for (const listener of this.listeners) listener(line, id);
    return line;
  }

  /** Calls `listener` with every event appended from now on and its index ID. */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Reserves the next free run reference. */
  nextRun(): string {
    const numbers = Object.keys(this.current.runs).map((ref) => {
      const reference = parseReference(ref);
      return reference?.kind === "run" ? reference.run : 0;
    });
    this.lastRun = Math.max(this.lastRun, ...numbers) + 1;
    return formatReference({ kind: "run", run: this.lastRun });
  }

  /** Reserves the next free local item reference, `K-<n>`. */
  nextLocalItem(): string {
    const numbers = Object.keys(this.current.items).map((ref) => {
      const reference = parseReference(ref);
      return reference?.kind === "item" && reference.item.repo === null ? reference.item.number : 0;
    });
    this.lastItem = Math.max(this.lastItem, ...numbers) + 1;
    return formatReference({ kind: "item", item: { repo: null, number: this.lastItem } });
  }

  private serial<T>(work: () => Promise<T>): Promise<T> {
    const result = this.queue.then(work);
    this.queue = result.catch(() => {});
    return result;
  }

  close() {
    this.index.close();
  }
}
