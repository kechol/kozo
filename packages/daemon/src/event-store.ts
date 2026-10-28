import { AsyncLocalStorage } from "node:async_hooks";
import { mkdir, open, readdir, truncate } from "node:fs/promises";
import { dirname, relative } from "node:path";
import {
  applyEvent,
  type Event,
  type EventLog,
  type EventType,
  emptyState,
  eventSchema,
  type FactoryState,
  formatReference,
  isRunOver,
  type KozoHome,
  mergeLogs,
  parseEventLog,
  parseReference,
  recordOnlyTypes,
  runFiles,
  sealIssues,
  sha256,
  withoutTornLine,
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

/** Builds the index from `events` in one transaction and returns the state they replay into. */
function fill(index: IndexDb, events: readonly Event[]): FactoryState {
  const state = emptyState();
  index.db.transaction(() => {
    for (const event of events) {
      applyEvent(state, event);
      index.record(event, state);
    }
  })();
  return state;
}

/** Six random lowercase letters and digits. */
function newFactoryId(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from(crypto.getRandomValues(new Uint8Array(6)), (byte) => alphabet[byte % 36]).join(
    "",
  );
}

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
    const name = relative(home.root, path);
    let text = await file.text();
    // A crash while writing leaves at most this; anything else in a log stays an error.
    const repaired = withoutTornLine(text);
    if (repaired !== null) {
      const kept = Buffer.byteLength(repaired);
      const dropped = Buffer.byteLength(text) - kept;
      await truncate(path, kept);
      console.error(
        `kozod: dropped the last ${dropped} bytes of ${name}, a line cut short by a crash`,
      );
      text = repaired;
    }
    const result = parseEventLog(text, name);
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
  private readonly apiCalls = new AsyncLocalStorage<string>();
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
    const index = IndexDb.create(home.db);
    let state: FactoryState;
    try {
      state = fill(index, events);
    } catch (error) {
      index.close();
      throw new EventLogError(`the event logs do not replay: ${(error as Error).message}`);
    }
    const store = new EventStore(home, state, index);
    for (const log of logs) {
      const end = log.events.at(-1);
      if (end) store.logs.set(end.run_id ?? "", { seq: end.seq + 1, last: log.last });
    }
    for (const ref of [...Object.keys(state.runs), ...Object.keys(state.items)]) store.count(ref);
    // A run that ended just before kozod stopped may not have its seal yet.
    for (const run of Object.values(state.runs)) {
      if (isRunOver(run.state) && !run.sealed) await store.serial(() => store.seal(run.ref));
    }
    if (state.factoryId === null) {
      await store.append({ type: "factory.created", data: { factory_id: newFactoryId() } });
    }
    return store;
  }

  get state(): Readonly<FactoryState> {
    return this.current;
  }

  /** The factory's ID, which every open store has. */
  get factoryId(): string {
    if (this.current.factoryId === null) throw new EventLogError("the factory has no ID");
    return this.current.factoryId;
  }

  get db() {
    return this.index.db;
  }

  /** Drops the index and builds it again from the logs. */
  async rebuildIndex(): Promise<void> {
    await this.serial(async () => {
      this.index.close();
      this.index = IndexDb.create(this.home.db);
      fill(this.index, mergeLogs((await readLogs(this.home)).map((log) => log.events)));
    });
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

  /**
   * Appends the event `decide` makes of the state, or nothing when it makes none, inside the
   * store's queue, so that no other event comes between the look at the state and the append.
   */
  appendIf(decide: (state: Readonly<FactoryState>) => NewEvent | null): Promise<Event | null> {
    return this.serial(async () => {
      const event = decide(this.current);
      if (event === null) return null;
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
      api_call: this.apiCalls.getStore() ?? null,
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
    // A record-only event changes nothing but lastTs, so a shallow copy is enough.
    const recordOnly = recordOnlyTypes.has(line.type);
    const next = recordOnly ? { ...this.current } : structuredClone(this.current);
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
    this.logs.set(log, { seq: line.seq + 1, last: sha256(text) });
    if (line.type === "run.started" && line.run_id) this.count(line.run_id);
    if (line.type === "item.created" && line.item) this.count(line.item);
    const id = this.index.record(line, next, text);
    for (const listener of this.listeners) listener(line, id);
    return line;
  }

  /**
   * Runs `work` for one local API write, so that every event it appends carries the write's
   * `api_call` ID. Work that kozod starts on its own afterwards runs outside it.
   */
  during<T>(apiCall: string, work: () => Promise<T>): Promise<T> {
    return this.apiCalls.run(apiCall, work);
  }

  /** Calls `listener` with every event appended from now on and its index ID. */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Keeps the run and local item counters past a reference in use. */
  private count(ref: string) {
    const reference = parseReference(ref);
    if (reference?.kind === "run") this.lastRun = Math.max(this.lastRun, reference.run);
    if (reference?.kind === "item" && reference.item.repo === null)
      this.lastItem = Math.max(this.lastItem, reference.item.number);
  }

  /** Reserves the next free run reference. */
  nextRun(): string {
    this.lastRun += 1;
    return formatReference({ kind: "run", run: this.lastRun });
  }

  /** Reserves the next free local item reference, `K-<n>`. */
  nextLocalItem(): string {
    this.lastItem += 1;
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
