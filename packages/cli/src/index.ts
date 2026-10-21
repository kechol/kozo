import { parseArgs } from "node:util";
import { gateLevelSchema } from "@kozo/core";
import {
  claudeJudge,
  diffGuardLine,
  gatesLine,
  proveLine,
  reviewLine,
  runDiffGuard,
  runGates,
  runProve,
  runReview,
  writeReviewVerdict,
} from "@kozo/verify";
import pkg from "../package.json" with { type: "json" };

export const ExitCode = { success: 0, failure: 1, usage: 2, awaitingHuman: 3 } as const;

/** The review model until the comparison on the bad-change suite picks one. */
export const defaultReviewModel = "claude-sonnet-5-5";

export interface Output {
  stdout(line: string): void;
  stderr(line: string): void;
  /** Write text to stdout or stderr as is, without adding a line break. */
  rawStdout(text: string): void;
  rawStderr(text: string): void;
}

const USAGE = `Usage: kozo <command>

Commands:
  gates [--level fast|full|deep] [--json]
      Run the gates of one level (default full)
  diff-guard --base <ref> [--head <ref>] [--scope <glob>]... [--json]
      Check the diff from the merge base of <ref> to <head> (default HEAD)
      against the Charter and constraints at the tip of <ref>
  prove --base <ref> [--json]
      Require the changed tests to pass at HEAD and to fail with the
      non-test changes reverted in place; the worktree must be clean
  review --base <ref> --goal <text> --done-when <text>... [--model <id>]
         [--max-cost <usd>] [--out <dir>] [--json]
      Judge the diff from the merge base of <ref> to HEAD in a separate
      claude session that sees only the diff, GOAL and DONE_WHEN; with
      --out, record the verdict in <dir>/verdict.json

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
  if (command === "diff-guard") return await diffGuard(rest, out, cwd);
  if (command === "prove") return await prove(rest, out, cwd);
  if (command === "review") return await review(rest, out, cwd);
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

async function diffGuard(args: readonly string[], out: Output, cwd: string): Promise<number> {
  let values: { base?: string; head?: string; scope?: string[]; json?: boolean };
  try {
    ({ values } = parseArgs({
      args: [...args],
      options: {
        base: { type: "string" },
        head: { type: "string", default: "HEAD" },
        scope: { type: "string", multiple: true },
        json: { type: "boolean" },
      },
      strict: true,
    }));
  } catch (error) {
    return usage(out, (error as Error).message);
  }
  if (values.base === undefined) return usage(out, "diff-guard needs --base <ref>");

  const result = await runDiffGuard({
    cwd,
    base: values.base,
    head: values.head ?? "HEAD",
    scope: values.scope,
    log: values.json ? out.rawStderr : out.rawStdout,
  });
  const line = diffGuardLine(result);
  if (values.json) out.stdout(JSON.stringify({ ...result, line }));
  else out.stdout(line);
  return result.status === "pass" ? ExitCode.success : ExitCode.failure;
}

async function prove(args: readonly string[], out: Output, cwd: string): Promise<number> {
  let values: { base?: string; json?: boolean };
  try {
    ({ values } = parseArgs({
      args: [...args],
      options: { base: { type: "string" }, json: { type: "boolean" } },
      strict: true,
    }));
  } catch (error) {
    return usage(out, (error as Error).message);
  }
  if (values.base === undefined) return usage(out, "prove needs --base <ref>");

  const result = await runProve({
    cwd,
    base: values.base,
    log: values.json ? out.rawStderr : out.rawStdout,
  });
  const line = proveLine(result);
  if (values.json) out.stdout(JSON.stringify({ ...result, line }));
  else out.stdout(line);
  return result.status === "pass" ? ExitCode.success : ExitCode.failure;
}

async function review(args: readonly string[], out: Output, cwd: string): Promise<number> {
  let values: {
    base?: string;
    goal?: string;
    "done-when"?: string[];
    model?: string;
    "max-cost"?: string;
    out?: string;
    json?: boolean;
  };
  try {
    ({ values } = parseArgs({
      args: [...args],
      options: {
        base: { type: "string" },
        goal: { type: "string" },
        "done-when": { type: "string", multiple: true },
        model: { type: "string", default: defaultReviewModel },
        "max-cost": { type: "string", default: "1" },
        out: { type: "string" },
        json: { type: "boolean" },
      },
      strict: true,
    }));
  } catch (error) {
    return usage(out, (error as Error).message);
  }
  const doneWhen = values["done-when"] ?? [];
  if (values.base === undefined || values.goal === undefined || doneWhen.length === 0) {
    return usage(
      out,
      "review needs --base <ref>, --goal <text> and at least one --done-when <text>",
    );
  }
  const maxCostUsd = Number(values["max-cost"]);
  if (!(maxCostUsd > 0)) return usage(out, "--max-cost must be a positive number of US dollars");
  const executable = Bun.which("claude");
  if (executable === null) {
    out.stderr("kozo: review needs the claude CLI on PATH");
    return ExitCode.failure;
  }

  const result = await runReview({
    cwd,
    base: values.base,
    goal: values.goal,
    doneWhen,
    judge: claudeJudge(executable),
    model: values.model ?? defaultReviewModel,
    maxCostUsd,
    log: values.json ? out.rawStderr : out.rawStdout,
  });
  if (result.status === "reviewed" && values.out !== undefined) {
    await writeReviewVerdict(values.out, result.record);
  }
  const line = reviewLine(result);
  if (values.json) out.stdout(JSON.stringify({ ...result, line }));
  else {
    if (result.status === "reviewed") {
      out.stdout(result.record.summary);
      for (const finding of result.record.findings) {
        const where = finding.path ? ` ${finding.path}:` : "";
        out.stdout(`- [${finding.severity}] ${finding.criterion}:${where} ${finding.issue}`);
      }
    }
    out.stdout(line);
  }
  if (result.status === "error") return ExitCode.failure;
  const codes = {
    accept: ExitCode.success,
    revise: ExitCode.failure,
    escalate: ExitCode.awaitingHuman,
  };
  return codes[result.record.verdict];
}

function usage(out: Output, problem: string | undefined): number {
  out.stderr(problem === undefined ? USAGE : `kozo: ${problem}\n\n${USAGE}`);
  return ExitCode.usage;
}
