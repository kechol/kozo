import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { type FactoryState, mergeLogs, parseEventLog, replay, sealIssues } from "@kozo/core";

/** The fixture directory of recorded logs named `name`, laid out as `~/.kozo` lays them out. */
export function recordedLogs(name: string): string {
  return join(import.meta.dir, "..", "fixtures", name);
}

/**
 * Replays every `events.jsonl` under `directory` without a model: kozod's own log and each
 * run's log, merged by `ts`. A malformed line throws with its log and line, and a run log that
 * does not match its seal throws too.
 */
export async function replayDirectory(directory: string): Promise<FactoryState> {
  const names = (await readdir(directory, { recursive: true }))
    .filter((name) => name === "events.jsonl" || name.endsWith("/events.jsonl"))
    .sort();
  const logs = await Promise.all(
    names.map(async (name) => {
      const path = join(directory, name);
      const result = parseEventLog(await Bun.file(path).text(), relative(directory, path));
      if (!result.ok) throw new Error(result.issues.join("\n"));
      return result.value;
    }),
  );
  const issues = sealIssues(logs);
  if (issues.length > 0) throw new Error(issues.join("\n"));
  return replay(mergeLogs(logs.map((log) => log.events)));
}
