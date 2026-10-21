import { homedir } from "node:os";
import { join } from "node:path";

/** The paths of one factory's home, `~/.kozo` unless `KOZO_HOME` names another. */
export interface KozoHome {
  root: string;
  /** kozod's own log, for events outside any run. */
  eventsLog: string;
  db: string;
  apiToken: string;
  pidFile: string;
  items: string;
  runs: string;
  worktrees: string;
  factory: string;
}

export function kozoHome(root = process.env.KOZO_HOME ?? join(homedir(), ".kozo")): KozoHome {
  return {
    root,
    eventsLog: join(root, "events.jsonl"),
    db: join(root, "kozo.db"),
    apiToken: join(root, "api.token"),
    pidFile: join(root, "kozod.pid"),
    items: join(root, "items"),
    runs: join(root, "runs"),
    worktrees: join(root, "worktrees"),
    factory: join(root, "factory"),
  };
}

/** The files of one run under `runs/<run>/`. */
export function runFiles(home: KozoHome, run: string) {
  const dir = join(home.runs, run);
  return {
    dir,
    events: join(dir, "events.jsonl"),
    queue: join(dir, "queue.jsonl"),
    brief: join(dir, "brief.md"),
    report: join(dir, "report.json"),
    decisions: join(dir, "decisions.md"),
    verdict: join(dir, "verdict.json"),
    evidence: join(dir, "evidence"),
  };
}
