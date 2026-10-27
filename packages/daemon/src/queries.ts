import type { Database } from "bun:sqlite";
import type { ListKind, Reference } from "@kozo/core";

const parsed = (row: Record<string, unknown> | null, columns: readonly string[]) => {
  if (!row) return row;
  for (const column of columns) {
    const value = row[column];
    if (typeof value === "string") row[column] = JSON.parse(value);
  }
  return row;
};

/** What waits for a human, oldest first: approvals, questions, attention and awaiting merge. */
const inboxQuery = `
  select 'item' as kind, ref, title, hold as waiting, hold_reason as reason, hold_since as since
    from items where hold in ('approval', 'question', 'attention')
  union all
  select 'task', t.ref, i.title, t.hold, t.hold_reason, t.hold_since
    from tasks t join items i on i.ref = t.item where t.hold in ('question', 'attention')
  union all
  select 'task', t.ref, i.title, 'merge', null, t.updated_at
    from tasks t join items i on i.ref = t.item where t.awaiting_merge = 1
  order by since, ref`;

export function list(db: Database, kind: ListKind) {
  switch (kind) {
    case "inbox":
      return db.query(inboxQuery).all();
    case "items":
      return db
        .query(
          "select ref, repository, title, stage, shown_stage, hold, hold_reason, updated_at from items order by created_at",
        )
        .all();
    case "tasks":
      return db
        .query(
          "select ref, item, goal, stage, hold, hold_reason, revisions, updated_at from tasks order by ref",
        )
        .all();
    case "runs":
      return db
        .query(
          "select ref, item, task, parent, agent, model, state, started_at, ended_at from runs order by started_at",
        )
        .all();
  }
}

export function inboxCount(db: Database): number {
  return db.query<{ n: number }, []>(`select count(*) as n from (${inboxQuery})`).get()?.n ?? 0;
}

/** The detail of one reference, or null when the index has no such item, task or run. */
export function detail(db: Database, ref: string, reference: Reference) {
  switch (reference.kind) {
    case "item": {
      const item = parsed(
        db.query<Record<string, unknown>, [string]>("select * from items where ref = ?").get(ref),
        ["plan", "draft"],
      );
      if (!item) return null;
      const tasks = db
        .query<Record<string, unknown>, [string]>("select * from tasks where item = ? order by ref")
        .all(ref)
        .map((row) => parsed(row, ["done_when", "scope", "depends_on", "checkpoint"]));
      const runs = db.query("select * from runs where item = ? order by started_at").all(ref);
      return { kind: "item", item, tasks, runs, cost_usd: costOf(db, "item", ref) };
    }
    case "task": {
      const task = parsed(
        db.query<Record<string, unknown>, [string]>("select * from tasks where ref = ?").get(ref),
        ["done_when", "scope", "depends_on", "checkpoint"],
      );
      if (!task) return null;
      const runs = db.query("select * from runs where task = ? order by started_at").all(ref);
      return { kind: "task", task, runs };
    }
    case "run": {
      const run = db.query("select * from runs where ref = ?").get(ref);
      if (!run) return null;
      const events = db
        .query<{ n: number }, [string]>("select count(*) as n from events where run_id = ?")
        .get(ref);
      return { kind: "run", run, events: events?.n ?? 0, cost_usd: costOf(db, "run_id", ref) };
    }
  }
}

/** The column that ties an event to a reference of this kind. */
export const eventColumn: Record<Reference["kind"], "item" | "task" | "run_id"> = {
  item: "item",
  task: "task",
  run: "run_id",
};

export function eventsAfter(db: Database, reference: Reference, ref: string, after: number) {
  return db
    .query<{ id: number; line: string }, [string, number]>(
      `select id, line from events where ${eventColumn[reference.kind]} = ? and id > ? order by id`,
    )
    .all(ref, after);
}

/** What the events of an item, a task or a run have cost. */
export function costOf(db: Database, column: "item" | "task" | "run_id", ref: string): number {
  return (
    db
      .query<{ usd: number }, [string]>(
        `select coalesce(sum(json_extract(line, '$.cost.usd')), 0) as usd from events where ${column} = ?`,
      )
      .get(ref)?.usd ?? 0
  );
}

/** Local midnight on the day of `now`, where the daily budget starts again. */
export function midnightOf(now: Date): Date {
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  return midnight;
}

/** What the events from `from`, and before `to` when given, added to the cost. */
export function costBetween(db: Database, from: Date, to?: Date): number {
  const bounds = [from, ...(to ? [to] : [])].map((date) => date.toISOString());
  return (
    db
      .query<{ usd: number }, string[]>(
        `select coalesce(sum(json_extract(line, '$.cost.usd')), 0) as usd from events where ts >= ?${to ? " and ts < ?" : ""}`,
      )
      .get(...bounds)?.usd ?? 0
  );
}

/** What the day's events added to the cost, from local midnight at `now`. */
export function costToday(db: Database, now: Date): number {
  return costBetween(db, midnightOf(now));
}

export function activeRuns(db: Database): number {
  return (
    db
      .query<{ n: number }, []>(
        "select count(*) as n from runs where state in ('running', 'paused')",
      )
      .get()?.n ?? 0
  );
}
