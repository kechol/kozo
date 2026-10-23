import { lstat, realpath } from "node:fs/promises";
import { extname, join } from "node:path";
import {
  blueprintNodes,
  type FactoryState,
  type KozoHome,
  type RunReport,
  runFiles,
  type TaskState,
  type VerdictFile,
} from "@kozo/core";
import { isInside } from "@kozo/verify";
import type { EventStore } from "./event-store.ts";
import { costOf } from "./queries.ts";

/** A blueprint node of a task's latest run, as far as the run got. */
export interface NodeProgress {
  node: string;
  state: "done" | "failed" | "running" | "pending";
  summary: string | null;
}

/** What one implement run of a task left in its directory; each part is null when absent. */
export interface RunRecord {
  run: string;
  report: RunReport | null;
  verdict: Partial<VerdictFile>;
  decisions: string;
}

/** The records of every implement run of a task, oldest first, read at once. */
export async function runRecords(
  home: KozoHome,
  state: FactoryState,
  task: TaskState,
): Promise<RunRecord[]> {
  const runs = task.runs.filter((ref) => state.runs[ref]?.agent === "implement");
  return await Promise.all(
    runs.map(async (run) => {
      const files = runFiles(home, run);
      const [report, verdict, decisions] = await Promise.all([
        Bun.file(files.report)
          .json()
          .catch(() => null) as Promise<RunReport | null>,
        Bun.file(files.verdict)
          .json()
          .catch(() => ({})) as Promise<Partial<VerdictFile>>,
        Bun.file(files.decisions)
          .text()
          .then((text) => text.trim())
          .catch(() => ""),
      ]);
      return { run, report, verdict, decisions };
    }),
  );
}

/**
 * What a task's runs left behind for the detail view: the latest run report and verdicts with
 * the run that holds each, every decision log, the latest run's progress through the blueprint
 * and what the task has cost.
 */
export async function taskRecords(home: KozoHome, store: EventStore, taskRef: string) {
  const state = store.state;
  const task = state.tasks[taskRef];
  if (!task) return null;
  const records = await runRecords(home, state, task);
  // Each part comes from the latest run that has one.
  const latestWith = <T>(pick: (record: RunRecord) => T | null | undefined) => {
    const found = records.findLast((record) => pick(record));
    const value = found ? pick(found) : null;
    return found && value ? { run: found.run, value } : null;
  };
  const written = latestWith((record) => record.report);
  const reviewed = latestWith((record) => record.verdict.review);
  const verified = latestWith((record) => record.verdict.verify);
  const report = written && { run: written.run, report: written.value };
  const review = reviewed && { run: reviewed.run, verdict: reviewed.value };
  const verify = verified && { run: verified.run, verdict: verified.value };
  const decisions = records
    .filter((record) => record.decisions)
    .map((record) => ({ run: record.run, text: record.decisions }));
  const latest = records.at(-1)?.run ?? null;
  const steps = latest
    ? store.db
        .query<{ type: string; node: string; ok: number | null; summary: string | null }, [string]>(
          "select type, json_extract(line, '$.node') as node, json_extract(line, '$.data.ok') as ok, json_extract(line, '$.data.summary') as summary from events where run_id = ? and type in ('node.enter', 'node.exit') order by id",
        )
        .all(latest)
    : [];
  const progress = new Map<string, NodeProgress>();
  for (const step of steps) {
    progress.set(step.node, {
      node: step.node,
      state: step.type === "node.enter" ? "running" : step.ok ? "done" : "failed",
      summary: step.summary,
    });
  }
  const ended = latest ? state.runs[latest]?.endedAt !== null : true;
  const nodes = blueprintNodes.map((node): NodeProgress => {
    const found = progress.get(node);
    if (!found) return { node, state: "pending", summary: null };
    // A node entered in a run that has ended did not finish.
    return found.state === "running" && ended ? { ...found, state: "failed" } : found;
  });
  return {
    report,
    review,
    verify,
    decisions,
    latest,
    nodes,
    costUsd: costOf(store.db, "task", taskRef),
  };
}

// Evidence that the dashboard shows in place; anything else is sent as a download, since an
// agent wrote it.
const inline: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".txt": "text/plain; charset=utf-8",
  ".log": "text/plain; charset=utf-8",
};

/**
 * One file that a verify session kept as evidence in a run's directory, or null when `path`
 * leaves the evidence directory, through `..` or a link, or names no regular file.
 */
export async function evidenceFile(
  home: KozoHome,
  run: string,
  path: string,
): Promise<{ file: ReturnType<typeof Bun.file>; type: string; inline: boolean } | null> {
  const root = await realpath(runFiles(home, run).evidence).catch(() => null);
  if (root === null) return null;
  const target = join(root, path);
  const resolved = await realpath(target).catch(() => null);
  if (resolved === null || resolved === root || !isInside(root, resolved)) return null;
  const entry = await lstat(resolved);
  if (!entry.isFile()) return null;
  const type = inline[extname(resolved).toLowerCase()];
  return {
    file: Bun.file(resolved),
    type: type ?? "application/octet-stream",
    inline: type !== undefined,
  };
}
