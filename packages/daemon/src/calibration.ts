import type { Database } from "bun:sqlite";
import { dayMs, type FactoryState, type WorkClass } from "@kozo/core";

/** What one task came to against its plan's estimate. */
export interface Measured {
  class: WorkClass;
  estimate: { lines: number; files: number };
  /** What diff-guard last counted of its diff, or null when it never got that far. */
  actual: { lines: number; files: number } | null;
  /** Whether its implement session stopped because the work did not fit its scope. */
  stoppedForScope: boolean;
}

/** How a repository's tasks of one class fared against their plans. */
export interface Calibration {
  class: WorkClass;
  /** The tasks it rests on, merged or stopped for their scope. */
  tasks: number;
  /** The median of counted to estimated lines, and of files. */
  lines: number;
  files: number;
  /** The share of the tasks that stopped for their scope. */
  scope_blocks: number;
}

// Fewer measured diffs than this say more about the tasks than about the class.
const minimum = 5;

/** How far back calibration looks. */
const window = 90;

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] ?? null)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

/** Each class with enough measured diffs, and how its tasks fared against their estimates. */
export function calibrate(measured: readonly Measured[]): Calibration[] {
  const classes = [...new Set(measured.map((task) => task.class))].sort();
  return classes.flatMap((workClass) => {
    const tasks = measured.filter((task) => task.class === workClass);
    const sized = tasks.flatMap((task) => (task.actual ? [{ ...task, actual: task.actual }] : []));
    if (sized.length < minimum) return [];
    return [
      {
        class: workClass,
        tasks: tasks.length,
        lines: median(sized.map((task) => task.actual.lines / task.estimate.lines)) ?? 1,
        files: median(sized.map((task) => task.actual.files / task.estimate.files)) ?? 1,
        scope_blocks: tasks.filter((task) => task.stoppedForScope).length / tasks.length,
      },
    ];
  });
}

/**
 * The tasks of `repository` that merged, or stopped for their scope, in the last 90 days: the
 * last diff each had counted, read from the index, and whether it was the task a split again
 * stopped.
 */
export function measuredTasks(
  db: Database,
  state: FactoryState,
  repository: string,
  now: Date,
): Measured[] {
  const since = new Date(now.getTime() - window * dayMs).toISOString();
  const counted = db.query<{ lines: number; files: number }, [string]>(
    "select json_extract(line, '$.data.lines') as lines, json_extract(line, '$.data.files') as files from events where type = 'diff.checked' and task = ? order by id desc limit 1",
  );
  const stopped = db.query<{ n: number }, [string, string, string]>(
    "select count(*) as n from events where type = 'stage.changed' and task = ? and json_extract(line, '$.data.reason.code') = 'stage.split-again' and json_extract(line, '$.data.reason.values.task') = ? and ts >= ?",
  );
  return Object.values(state.tasks).flatMap((task) => {
    if (state.items[task.item]?.repository !== repository) return [];
    const stoppedForScope = (stopped.get(task.ref, task.ref, since)?.n ?? 0) > 0;
    const merged = task.merged !== null && task.merged.at >= since;
    if (!merged && !stoppedForScope) return [];
    return [
      {
        class: task.class,
        estimate: task.estimate,
        actual: merged ? (counted.get(task.ref) ?? null) : null,
        stoppedForScope,
      },
    ];
  });
}

/** One line for an agent that drafts a plan, per class with enough measured diffs. */
export function calibrationLines(calibrations: readonly Calibration[]): string[] {
  const times = (ratio: number) => `${ratio.toFixed(1)}x`;
  return calibrations.map(
    (c) =>
      `CALIBRATION ${c.class}: over ${c.tasks} recent tasks here, diffs came to ${times(c.lines)} the estimated lines and ${times(c.files)} the estimated files, and ${Math.round(c.scope_blocks * 100)}% stopped for their scope`,
  );
}
