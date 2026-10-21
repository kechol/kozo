import { join } from "node:path";
import { type GateLevel, parseConstraints } from "@kozo/core";
import { resolveBase } from "./changes.ts";
import { runCommand, secondsSince } from "./command.ts";
import { GitError, showFile } from "./git.ts";

export interface GateRun {
  name: string;
  exitCode: number;
  seconds: number;
}

export type GatesResult = { level: GateLevel; gates: GateRun[]; seconds: number } & (
  | { status: "pass" }
  | { status: "fail"; failed: string }
  | { status: "MISCONFIGURED"; reason: MisconfiguredReason }
);

export type MisconfiguredReason =
  | "constraints-missing"
  | "constraints-invalid"
  | "level-missing"
  | "base-unknown";

export interface GatesOptions {
  cwd: string;
  level: GateLevel;
  /**
   * When set, the constraints are read at the tip of this ref, as diff-guard reads them, so
   * that a change in the worktree cannot redefine the gates it is checked by. When unset, they
   * are read from the worktree, for a developer running the gates by hand.
   */
  base?: string;
  /** Receives the gates' own output and kozo's progress lines, unchanged. */
  log(text: string): void;
}

// A repository path, used both on disk and inside git commits.
export const constraintsPath = ".kozo/constraints.yml";

export async function runGates({ cwd, level, base, log }: GatesOptions): Promise<GatesResult> {
  const started = performance.now();
  const elapsed = () => secondsSince(started);
  const misconfigured = (reason: MisconfiguredReason): GatesResult => ({
    level,
    gates: [],
    seconds: elapsed(),
    status: "MISCONFIGURED",
    reason,
  });

  let text: string | null;
  try {
    text = await readConstraints(cwd, base);
  } catch (error) {
    if (!(error instanceof GitError)) throw error;
    log(`kozo: ${error.message}\n`);
    return misconfigured("base-unknown");
  }
  if (text === null) {
    log(`kozo: ${constraintsPath} not found\n`);
    return misconfigured("constraints-missing");
  }
  const parsed = parseConstraints(text);
  if (!parsed.ok) {
    for (const issue of parsed.issues) log(`kozo: ${constraintsPath}: ${issue}\n`);
    return misconfigured("constraints-invalid");
  }
  const names = parsed.value.levels[level];
  if (!names) {
    log(`kozo: ${constraintsPath} defines no ${level} level\n`);
    return misconfigured("level-missing");
  }

  // Gate output may end mid-line; kozo's own lines, and the KOZO_GATES line after the
  // return, must still start on a line of their own.
  let atLineStart = true;
  const emit = (text: string) => {
    if (text === "") return;
    log(text);
    atLineStart = text.endsWith("\n");
  };
  const endLine = () => emit(atLineStart ? "" : "\n");

  const gates: GateRun[] = [];
  for (const name of names) {
    endLine();
    emit(`==> ${name}\n`);
    // The constraints schema guarantees every listed gate is defined.
    const run = parsed.value.gates[name]?.run ?? "";
    const gateStarted = performance.now();
    const exitCode = await runCommand(run, cwd, emit);
    gates.push({ name, exitCode, seconds: secondsSince(gateStarted) });
    if (exitCode !== 0) {
      endLine();
      return { level, gates, seconds: elapsed(), status: "fail", failed: name };
    }
  }
  endLine();
  return { level, gates, seconds: elapsed(), status: "pass" };
}

async function readConstraints(cwd: string, base: string | undefined) {
  if (base !== undefined) return await showFile(cwd, await resolveBase(cwd, base), constraintsPath);
  const file = Bun.file(join(cwd, constraintsPath));
  return (await file.exists()) ? await file.text() : null;
}

/** The single line by which kozod judges the gates; it is always the last line printed. */
export function gatesLine(result: GatesResult): string {
  const fields = [`level=${result.level}`, `status=${result.status}`];
  if (result.status === "MISCONFIGURED") fields.push(`reason=${result.reason}`);
  else fields.push(`gates=${result.gates.map((gate) => gate.name).join(",")}`);
  if (result.status === "fail") fields.push(`failed=${result.failed}`);
  fields.push(`duration=${result.seconds}s`);
  return `KOZO_GATES: ${fields.join(" ")}`;
}
