import pkg from "../package.json" with { type: "json" };

export const ExitCode = { success: 0, usage: 2 } as const;

export interface Output {
  stdout(text: string): void;
  stderr(text: string): void;
}

const USAGE = `Usage: kozod [options]

Options:
  --version  Print the version`;

export function run(args: readonly string[], out: Output): number {
  const [option] = args;
  if (option === "--version") {
    out.stdout(`kozod ${pkg.version}`);
    return ExitCode.success;
  }
  out.stderr(option === undefined ? USAGE : `kozod: unknown option '${option}'\n\n${USAGE}`);
  return ExitCode.usage;
}
