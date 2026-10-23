import { lstat, realpath } from "node:fs/promises";
import { extname, join, relative, sep } from "node:path";
import {
  blueprintNodes,
  type KozoHome,
  type RunReport,
  runFiles,
  type VerdictFile,
} from "@kozo/core";
import type { EventStore } from "./event-store.ts";

/** A blueprint node of a task's latest run, as far as the run got. */
export interface NodeProgress {
  node: string;
  state: "done" | "failed" | "running" | "pending";
  summary: string | null;
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
  const runs = task.runs.filter((ref) => state.runs[ref]?.agent === "implement");
  let report: { run: string; report: RunReport } | null = null;
  let review: { run: string; verdict: NonNullable<VerdictFile["review"]> } | null = null;
  let verify: { run: string; verdict: NonNullable<VerdictFile["verify"]> } | null = null;
  const decisions: { run: string; text: string }[] = [];
  for (const run of runs) {
    const files = runFiles(home, run);
    const written = await Bun.file(files.report)
      .json()
      .catch(() => null);
    if (written) report = { run, report: written as RunReport };
    const verdict = (await Bun.file(files.verdict)
      .json()
      .catch(() => ({}))) as Partial<VerdictFile>;
    if (verdict.review) review = { run, verdict: verdict.review };
    if (verdict.verify) verify = { run, verdict: verdict.verify };
    const text = await Bun.file(files.decisions)
      .text()
      .catch(() => "");
    if (text.trim()) decisions.push({ run, text: text.trim() });
  }
  const latest = runs.at(-1) ?? null;
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
  const cost =
    store.db
      .query<{ usd: number }, [string]>(
        "select coalesce(sum(json_extract(line, '$.cost.usd')), 0) as usd from events where task = ?",
      )
      .get(taskRef)?.usd ?? 0;
  return { report, review, verify, decisions, latest, nodes, costUsd: cost };
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
  if (
    resolved === null ||
    relative(root, resolved).startsWith("..") ||
    !resolved.startsWith(root + sep)
  )
    return null;
  const entry = await lstat(resolved);
  if (!entry.isFile()) return null;
  const type = inline[extname(resolved).toLowerCase()];
  return {
    file: Bun.file(resolved),
    type: type ?? "application/octet-stream",
    inline: type !== undefined,
  };
}
