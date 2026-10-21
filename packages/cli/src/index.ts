import { parseArgs } from "node:util";
import { gateLevelSchema } from "@kozo/core";
import { gatesLine, runGates } from "@kozo/verify";
import pkg from "../package.json" with { type: "json" };

export const ExitCode = { success: 0, failure: 1, usage: 2 } as const;

export interface Output {
  stdout(line: string): void;
  stderr(line: string): void;
  /** Write text to stdout or stderr as is, without adding a line break. */
  rawStdout(text: string): void;
  rawStderr(text: string): void;
}

const USAGE = `Usage: kozo <command>

Commands:
  gates [--level fast|full|deep] [--json]  Run the gates of one level (default full)

Options:
  --version  Print the version`;

export async function run(
  args: readonly string[],
  out: Output,
  cwd = process.cwd(),
): Promise<number> {
  const [command, ...rest] = args;
  if (command === "--version") {
    out.stdout(`kozo ${pkg.version}`);
    return ExitCode.success;
  }
  if (command === "gates") return await gates(rest, out, cwd);
  return usage(out, command === undefined ? undefined : `unknown command '${command}'`);
}

async function gates(args: readonly string[], out: Output, cwd: string): Promise<number> {
  let values: { level?: string; json?: boolean };
  try {
    ({ values } = parseArgs({
      args: [...args],
      options: { level: { type: "string", default: "full" }, json: { type: "boolean" } },
      strict: true,
    }));
  } catch (error) {
    return usage(out, (error as Error).message);
  }
  const level = gateLevelSchema.safeParse(values.level);
  if (!level.success) return usage(out, `unknown gate level '${values.level}'`);

  // With --json, stdout carries only the JSON document, so gate output goes to stderr.
  const result = await runGates({
    cwd,
    level: level.data,
    log: values.json ? out.rawStderr : out.rawStdout,
  });
  const line = gatesLine(result);
  if (values.json) out.stdout(JSON.stringify({ ...result, line }));
  else out.stdout(line);
  return result.status === "pass" ? ExitCode.success : ExitCode.failure;
}

function usage(out: Output, problem: string | undefined): number {
  out.stderr(problem === undefined ? USAGE : `kozo: ${problem}\n\n${USAGE}`);
  return ExitCode.usage;
}
