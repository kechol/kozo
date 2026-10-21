import pkg from "../package.json" with { type: "json" };
import { Daemon } from "./daemon.ts";

export const ExitCode = { success: 0, failure: 1, usage: 2 } as const;

export interface Output {
  stdout(text: string): void;
  stderr(text: string): void;
}

const USAGE = `Usage: kozod [options]

Runs kozod in the foreground until it receives SIGINT or SIGTERM.

Options:
  --version  Print the version`;

/** Starts kozod and resolves once it has stopped again. */
async function serve(out: Output): Promise<number> {
  let daemon: Daemon;
  try {
    daemon = await Daemon.start();
  } catch (error) {
    out.stderr(`kozod: ${(error as Error).message}`);
    return ExitCode.failure;
  }
  out.stdout(`kozod ${pkg.version} listening on http://127.0.0.1:${daemon.port}`);
  await new Promise<void>((resolve) => {
    process.once("SIGINT", resolve);
    process.once("SIGTERM", resolve);
  });
  await daemon.stop();
  return ExitCode.success;
}

export async function run(args: readonly string[], out: Output): Promise<number> {
  const [option] = args;
  if (option === undefined) return await serve(out);
  if (option === "--version") {
    out.stdout(`kozod ${pkg.version}`);
    return ExitCode.success;
  }
  out.stderr(`kozod: unknown option '${option}'\n\n${USAGE}`);
  return ExitCode.usage;
}

export { Daemon } from "./daemon.ts";
