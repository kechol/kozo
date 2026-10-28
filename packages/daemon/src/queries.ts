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

/** The branch, head and report of the task's last final verification that passed. */
export function lastHandoff(
  db: Database,
  task: string,
): { branch: string; head: string; report: string } | null {
  return db
    .query<{ branch: string; head: string; report: string }, [string]>(
      "select branch, head, report from handoffs where task = ? order by id desc limit 1",
    )
    .get(task);
}

/** The subjects of kozod's writes of `action` for an item, or for one of its tasks. */
export function externalWrites(
  db: Database,
  item: string,
  task: string | null,
  action: string,
): string[] {
  return db
    .query<{ subject: string }, [string, string | null, string | null, string]>(
      "select subject from external_writes where item = ? and (task = ? or ? is null) and action = ? order by id",
    )
    .all(item, task, task, action)
    .map((row) => row.subject);
}

/** Each task's pull request, as the last one kozod opened or updated for it. */
export function pullsOf(db: Database, item: string): Map<string, string> {
  const rows = db
    .query<{ task: string; subject: string }, [string]>(
      "select task, subject from external_writes where item = ? and action = 'pull' order by id",
    )
    .all(item);
  return new Map(rows.map((row) => [row.task, row.subject]));
}

/** Whether kozod has held `task` for `reason` before. */
export function heldBefore(db: Database, task: string, reason: string): boolean {
  return (
    db
      .query<{ found: number }, [string, string]>(
        "select 1 as found from holds where task = ? and reason = ? limit 1",
      )
      .get(task, reason) !== null
  );
}

/** What the task's last node said when it did not pass, or null when it passed. */
export function lastFailure(db: Database, task: string): string | null {
  return (
    db
      .query<{ failure: string | null }, [string]>(
        "select last_failure as failure from tasks where ref = ?",
      )
      .get(task)?.failure ?? null
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
