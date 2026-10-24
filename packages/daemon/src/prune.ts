import { readdir, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import { dayMs, type KozoHome, runFiles } from "@kozo/core";
import type { EventStore } from "./event-store.ts";

/** What a pruned run keeps: its event log, which kozo.db is rebuilt from, and its small records. */
const kept = (home: KozoHome, run: string) => {
  const files = runFiles(home, run);
  return new Set(
    [files.events, files.report, files.verdict, files.decisions].map((path) => basename(path)),
  );
};

/**
 * Prunes each run of an item that reached Complete or Cancelled at least `days` days before
 * `now` to what `kept` names, and records the runs it pruned as `factory.pruned`; with `dryRun`
 * it only lists them. A run that has nothing more to remove is left out.
 */
export async function pruneRecords(
  home: KozoHome,
  store: EventStore,
  days: number,
  dryRun: boolean,
  now = new Date(),
): Promise<{ message: string; before: string; runs: string[] }> {
  const before = new Date(now.getTime() - days * dayMs).toISOString();
  const state = store.state;
  const closed = (ref: string) => {
    const item = state.items[ref];
    return item?.closedAt != null && item.closedAt <= before;
  };
  const runs: string[] = [];
  for (const run of Object.values(state.runs)) {
    if (run.endedAt === null || !closed(run.item)) continue;
    const { dir } = runFiles(home, run.ref);
    const keep = kept(home, run.ref);
    const extra = (await readdir(dir).catch(() => [])).filter((name) => !keep.has(name));
    if (extra.length === 0) continue;
    runs.push(run.ref);
    if (dryRun) continue;
    for (const name of extra) await rm(join(dir, name), { recursive: true, force: true });
  }
  runs.sort();
  const [first] = runs;
  if (!dryRun && first !== undefined)
    await store.append({
      type: "factory.pruned",
      data: { before, runs: [first, ...runs.slice(1)] },
    });
  const date = before.slice(0, 10);
  const message =
    runs.length === 0
      ? `no run of an item closed before ${date} has records to prune`
      : dryRun
        ? `would prune ${runs.length} runs of items closed before ${date}: ${runs.join(", ")}`
        : `pruned ${runs.length} runs of items closed before ${date} to their logs and verdicts`;
  return { message, before, runs };
}
