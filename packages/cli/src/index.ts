import pkg from "../package.json" with { type: "json" };

export const ExitCode = { success: 0, usage: 2 } as const;

export interface Output {
  stdout(text: string): void;
  stderr(text: string): void;
}

const USAGE = `Usage: kozo <command>

Options:
  --version  Print the version`;

export function run(args: readonly string[], out: Output): number {
  const [command] = args;
  if (command === "--version") {
    out.stdout(`kozo ${pkg.version}`);
    return ExitCode.success;
  }
  out.stderr(command === undefined ? USAGE : `kozo: unknown command '${command}'\n\n${USAGE}`);
  return ExitCode.usage;
}
