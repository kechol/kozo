import type { Database } from "bun:sqlite";
import {
  autonomyLevel,
  dayMs,
  type Factory,
  type FactoryState,
  promotionProposals,
  type TaskState,
  waitsOnOwner,
  workClassSchema,
} from "@kozo/core";
import { costBetween, costOf, costToday, midnightOf } from "./queries.ts";
import { readCharter } from "./repository.ts";

export type ReportView = "summary" | "review" | "cost";

/** The window a report covers when the request names none, and the longest it may cover. */
export const reportDays = { default: 30, max: 365 } as const;

/** The middle value of `values`, or null when there is none. */
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] ?? null)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

const share = (part: number, whole: number) => (whole === 0 ? null : part / whole);

/** A diff's cost: its runs, children included, and an equal share of its item's own cost. */
function diffCost(db: Database, state: FactoryState, task: TaskState): number {
  const own =
    db
      .query<{ usd: number }, [string]>(
        "select coalesce(sum(json_extract(line, '$.cost.usd')), 0) as usd from events where item = ? and task is null",
      )
      .get(task.item)?.usd ?? 0;
  const tasks = state.items[task.item]?.tasks.length ?? 1;
  return costOf(db, "task", task.ref) + own / Math.max(tasks, 1);
}

export interface Failure {
  kind: "revise" | "escalate" | "defect" | "human-commit" | "missing-tool";
  ref: string;
  at: string;
  text: string;
}

/**
 * The failures since `since` that the retrospective reads: review verdicts of revise and
 * escalate, failed checks after a merge, human commits and blocks for a missing tool, oldest
 * first.
 */
function failures(db: Database, state: FactoryState, since: string): Failure[] {
  const rows = db
    .query<
      {
        ts: string;
        type: string;
        ref: string;
        verdict: string | null;
        text: string | null;
        from: string | null;
        to: string | null;
        blocked: string | null;
      },
      [string]
    >(
      `select ts, type, coalesce(task, item) as ref,
              json_extract(line, '$.data.verdict') as verdict,
              coalesce(json_extract(line, '$.data.summary'), json_extract(line, '$.data.text'),
                       json_extract(line, '$.data.reason')) as text,
              json_extract(line, '$.data.from') as "from", json_extract(line, '$.data.to') as "to",
              json_extract(line, '$.data.blocked') as blocked
         from events
        where ts >= ? and type in ('review.verdict', 'task.returned', 'stage.changed', 'hold.set')
        order by ts, id`,
    )
    .all(since);
  // A defect is the state's, so that the list and the defect rate count the same ones.
  const defects = Object.values(state.tasks).flatMap((task): Failure[] => {
    if (task.defectAt === null || task.defectAt < since) return [];
    const note = state.items[task.item]?.notes.find(
      (candidate) => candidate.target === task.ref && candidate.ts === task.defectAt,
    );
    return [{ kind: "defect", ref: task.ref, at: task.defectAt, text: note?.text ?? "" }];
  });
  const found = rows.flatMap((row): Failure[] => {
    const failure = (kind: Failure["kind"], text = row.text ?? "") => [
      { kind, ref: row.ref, at: row.ts, text },
    ];
    if (row.type === "review.verdict" && (row.verdict === "revise" || row.verdict === "escalate"))
      return failure(row.verdict);
    if (row.type === "task.returned") return failure("human-commit", "taken and given back");
    // Only a human's commit moves a task from Handoff to Reviewing.
    if (row.type === "stage.changed" && row.from === "handoff" && row.to === "reviewing")
      return failure("human-commit");
    if (row.type === "hold.set" && row.blocked === "missing-tool")
      return failure("missing-tool", (row.text ?? "").replace(/^missing-tool: /, ""));
    return [];
  });
  return [...found, ...defects].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
}

/** The metrics over the diffs merged since `since`, and what waits now. */
function metrics(db: Database, state: FactoryState, since: string) {
  const merged = Object.values(state.tasks).filter(
    (task) => task.merged !== null && task.merged.at >= since,
  );
  const reviews = db
    .query<{ verdict: string }, [string]>(
      "select json_extract(line, '$.data.verdict') as verdict from events where type = 'review.verdict' and ts >= ?",
    )
    .all(since);
  const waits = merged.flatMap((task) =>
    task.handedOffAt && task.merged
      ? [(Date.parse(task.merged.at) - Date.parse(task.handedOffAt)) / (60 * 60 * 1000)]
      : [],
  );
  const held = [...Object.values(state.items), ...Object.values(state.tasks)].filter((subject) =>
    waitsOnOwner(subject.hold),
  ).length;
  return {
    merged: merged.length,
    autonomy_rate: share(merged.filter((task) => !task.humanCommits).length, merged.length),
    defect_rate: share(merged.filter((task) => task.defectAt !== null).length, merged.length),
    cost_per_diff_usd: median(merged.map((task) => diffCost(db, state, task))),
    hours_to_merge: median(waits),
    reviews: reviews.length,
    revise_rate: share(
      reviews.filter((review) => review.verdict === "revise").length,
      reviews.length,
    ),
    held,
  };
}

/**
 * What `kozo report` shows for `view` over the last `days` days: the metrics, the failures and
 * the promotion proposals; `review` adds each repository's levels as kozod applies them, its
 * demotions and the window's cost, and `cost` is each day's cost and today's against the budget.
 */
export async function buildReport(
  db: Database,
  state: FactoryState,
  factory: Factory,
  view: ReportView,
  days: number = reportDays.default,
  now = new Date(),
) {
  const budget = factory.budget.daily_usd;
  if (view === "cost") {
    const today = costToday(db, now);
    // Calendar days in local time, so a day of a daylight saving change keeps its own hours.
    const daily = Array.from({ length: days }, (_, back) => {
      const start = midnightOf(now);
      start.setDate(start.getDate() - back);
      const end = new Date(start);
      end.setDate(end.getDate() + 1);
      return { day: start.toISOString(), usd: costBetween(db, start, end) };
    });
    return { view, budget_usd: budget, today_usd: today, days: daily };
  }
  const since = new Date(now.getTime() - days * dayMs).toISOString();
  const repositories = await Promise.all(
    factory.repositories.map(async ({ path }) => ({
      path,
      charter: await readCharter(path, factory.mode, state),
    })),
  );
  const promotions = repositories.flatMap(({ path, charter }) =>
    charter.ok
      ? promotionProposals(state, path, charter.charter).map((workClass) => ({
          repository: path,
          class: workClass,
        }))
      : [],
  );
  const result = {
    view,
    days,
    since,
    ...metrics(db, state, since),
    failures: failures(db, state, since),
    promotions,
  };
  if (view === "summary") return result;
  const levels = repositories.flatMap(({ path, charter }) =>
    charter.ok
      ? workClassSchema.options.map((workClass) => ({
          repository: path,
          class: workClass,
          level: autonomyLevel(charter.charter, workClass),
        }))
      : [],
  );
  return {
    ...result,
    levels,
    demotions: Object.values(state.demotions),
    cost_usd: costBetween(db, new Date(since)),
  };
}
