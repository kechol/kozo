import { Database } from "bun:sqlite";
import {
  awaitingMerge,
  type Event,
  type FactoryState,
  itemStage,
  recordOnlyTypes,
} from "@kozo/core";

export const indexSchemaVersion = 4;

const schema = `
create table meta (key text primary key, value text not null);
create table items (
  ref text primary key, repository text not null, title text not null, source text not null,
  stage text not null, shown_stage text not null,
  hold text, hold_reason text, hold_since text,
  plan text, draft text, created_at text not null, updated_at text not null,
  hold_approval text
);
create table tasks (
  ref text primary key, item text not null, goal text not null, done_when text not null,
  scope text not null, depends_on text not null, stage text not null,
  hold text, hold_reason text, hold_since text,
  revisions integer not null, handoff_fixes integer not null, checkpoint text,
  awaiting_merge integer not null, updated_at text not null,
  -- What the task's last node said when it did not pass, for its next attempt; null after a pass.
  last_failure text,
  hold_approval text
);
create table handoffs (
  id integer primary key, task text not null, head text not null, branch text not null,
  report text not null
);
create index handoffs_task on handoffs (task, id);
create table external_writes (
  id integer primary key, item text not null, task text, target text not null,
  action text not null, subject text not null
);
create index external_writes_item on external_writes (item, action, id);
create table holds (
  id integer primary key, item text not null, task text, kind text not null,
  reason text not null, by text not null
);
create index holds_task on holds (task, id);
create table runs (
  ref text primary key, item text not null, task text, parent text, agent text not null,
  model text not null, state text not null, started_at text not null, ended_at text
);
create table events (
  id integer primary key, ts text not null, log text not null, seq integer not null,
  run_id text, item text, task text, type text not null, line text not null
);
create index events_item on events (item, id);
create index events_item_type on events (item, type, id);
create index events_ts on events (ts);
create index events_task on events (task, id);
create index events_run on events (run_id, id);
`;

const json = (value: unknown) =>
  value === null || value === undefined ? null : JSON.stringify(value);

/**
 * The SQLite index of a factory: items, tasks, runs and every event, all derived from the
 * event logs. Only kozod writes it, and it can always be dropped and rebuilt.
 */
export class IndexDb {
  readonly db: Database;

  private constructor(db: Database) {
    this.db = db;
  }

  /** Creates the index afresh at `path`, replacing whatever was there. */
  static create(path: string): IndexDb {
    const db = new Database(path, { create: true, strict: true });
    db.exec("pragma journal_mode = wal");
    // The index is rebuilt from the event logs at every start, so it needs no durability.
    db.exec("pragma synchronous = off");
    const tables = db
      .query<{ name: string }, []>("select name from sqlite_master where type = 'table'")
      .all();
    db.transaction(() => {
      for (const { name } of tables) db.exec(`drop table "${name}"`);
      db.exec(schema);
      db.query("insert into meta (key, value) values ('schema_version', ?)").run(
        String(indexSchemaVersion),
      );
    })();
    return new IndexDb(db);
  }

  /**
   * Records one event, given as its line when the caller has it, and the current rows of what
   * it touched, in one transaction.
   */
  record(event: Event, state: FactoryState, line = JSON.stringify(event)): number {
    let id = 0;
    this.db.transaction(() => {
      const result = this.db
        .query(
          "insert into events (ts, log, seq, run_id, item, task, type, line) values (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          event.ts,
          event.run_id ?? "kozod",
          event.seq,
          event.run_id,
          event.item,
          event.task,
          event.type,
          line,
        );
      id = Number(result.lastInsertRowid);
      if (!recordOnlyTypes.has(event.type)) this.project(event, state);
      this.keep(event);
    })();
    return id;
  }

  /** Keeps the facts kozod looks up by item or task in tables of their own. */
  private keep(event: Event) {
    switch (event.type) {
      case "handoff.ready":
        this.db
          .query("insert into handoffs (task, head, branch, report) values (?, ?, ?, ?)")
          .run(event.task, event.data.head, event.data.branch, event.data.report);
        break;
      case "external.write":
        this.db
          .query(
            "insert into external_writes (item, task, target, action, subject) values (?, ?, ?, ?, ?)",
          )
          .run(event.item, event.task, event.data.target, event.data.action, event.data.subject);
        break;
      case "hold.set":
        this.db
          .query("insert into holds (item, task, kind, reason, by) values (?, ?, ?, ?, ?)")
          .run(
            event.item,
            event.task,
            event.data.hold,
            JSON.stringify(event.data.reason),
            event.data.by,
          );
        break;
      case "node.exit":
        if (event.task === null) break;
        this.db
          .query("update tasks set last_failure = ? where ref = ?")
          .run(event.data.ok ? null : (event.data.summary ?? null), event.task);
        break;
    }
  }

  private project(event: Event, state: FactoryState) {
    const item = event.item === null ? undefined : state.items[event.item];
    if (item) {
      this.db
        .query(`insert or replace into items values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(
          item.ref,
          item.repository,
          item.title,
          item.source,
          item.stage,
          itemStage(state, item),
          item.hold?.kind ?? null,
          item.hold ? JSON.stringify(item.hold.reason) : null,
          item.hold?.since ?? null,
          json(item.plan),
          json(item.draft),
          item.createdAt,
          item.updatedAt,
          item.hold?.approval ?? null,
        );
      for (const ref of item.tasks) {
        const task = state.tasks[ref];
        if (!task) continue;
        this.db
          // An upsert, so that the last failure a node.exit left stays.
          .query(
            `insert into tasks values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, null, ?)
             on conflict (ref) do update set item = excluded.item, goal = excluded.goal,
               done_when = excluded.done_when, scope = excluded.scope,
               depends_on = excluded.depends_on, stage = excluded.stage, hold = excluded.hold,
               hold_reason = excluded.hold_reason, hold_since = excluded.hold_since,
               revisions = excluded.revisions, handoff_fixes = excluded.handoff_fixes,
               checkpoint = excluded.checkpoint, awaiting_merge = excluded.awaiting_merge,
               updated_at = excluded.updated_at, hold_approval = excluded.hold_approval`,
          )
          .run(
            task.ref,
            task.item,
            task.goal,
            json(task.done_when),
            json(task.scope),
            json(task.depends_on),
            task.stage,
            task.hold?.kind ?? null,
            task.hold ? JSON.stringify(task.hold.reason) : null,
            task.hold?.since ?? null,
            task.revisions,
            task.handoffFixes,
            json(task.checkpoint),
            awaitingMerge(state, task) ? 1 : 0,
            task.updatedAt,
            task.hold?.approval ?? null,
          );
      }
    }
    const run = event.run_id === null ? undefined : state.runs[event.run_id];
    if (run) {
      this.db
        .query(`insert or replace into runs values (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(
          run.ref,
          run.item,
          run.task,
          run.parent,
          run.agent,
          run.model,
          run.state,
          run.startedAt,
          run.endedAt,
        );
    }
  }

  close() {
    this.db.close();
  }
}
