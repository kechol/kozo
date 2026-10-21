import { join } from "node:path";
import { type GateLevel, parseConstraints } from "@kozo/core";

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

export type MisconfiguredReason = "constraints-missing" | "constraints-invalid" | "level-missing";

export interface GatesOptions {
  cwd: string;
  level: GateLevel;
  /** Receives the gates' own output and kozo's progress lines, unchanged. */
  log(text: string): void;
}

// A repository path, used both on disk and inside git commits.
export const constraintsPath = ".kozo/constraints.yml";

export async function runGates({ cwd, level, log }: GatesOptions): Promise<GatesResult> {
  const started = performance.now();
  const elapsed = () => secondsSince(started);
  const misconfigured = (reason: MisconfiguredReason): GatesResult => ({
    level,
    gates: [],
    seconds: elapsed(),
    status: "MISCONFIGURED",
    reason,
  });

  const file = Bun.file(join(cwd, constraintsPath));
  if (!(await file.exists())) {
    log(`kozo: ${constraintsPath} not found\n`);
    return misconfigured("constraints-missing");
  }
  const parsed = parseConstraints(await file.text());
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

/** The single line by which kozod judges the gates; it is always the last line printed. */
export function gatesLine(result: GatesResult): string {
  const fields = [`level=${result.level}`, `status=${result.status}`];
  if (result.status === "MISCONFIGURED") fields.push(`reason=${result.reason}`);
  else fields.push(`gates=${result.gates.map((gate) => gate.name).join(",")}`);
  if (result.status === "fail") fields.push(`failed=${result.failed}`);
  fields.push(`duration=${result.seconds}s`);
  return `KOZO_GATES: ${fields.join(" ")}`;
}

async function runCommand(command: string, cwd: string, log: (text: string) => void) {
  const child = Bun.spawn(["sh", "-c", command], {
    cwd,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  await Promise.all([forward(child.stdout, log), forward(child.stderr, log)]);
  return await child.exited;
}

async function forward(stream: ReadableStream<Uint8Array>, log: (text: string) => void) {
  const decoder = new TextDecoder();
  for await (const chunk of stream) log(decoder.decode(chunk, { stream: true }));
  const rest = decoder.decode();
  if (rest) log(rest);
}

function secondsSince(start: number) {
  return Math.round((performance.now() - start) / 1000);
}
