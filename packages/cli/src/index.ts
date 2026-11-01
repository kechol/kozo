import { parseArgs } from "node:util";
import { gateLevelSchema, kozoHome, type Locale, verbSchema } from "@kozo/core";
import {
  claudeJudge,
  claudeVerifier,
  diffGuardLine,
  gatesLine,
  proveLine,
  reviewLine,
  runDiffGuard,
  runGates,
  runProve,
  runReview,
  runVerify,
  verifyLine,
  writeReviewVerdict,
  writeVerifyVerdict,
} from "@kozo/verify";
import pkg from "../package.json" with { type: "json" };
import { check } from "./check.ts";
import {
  add,
  admin,
  dashboard,
  down,
  ExitCode,
  ls,
  metricsReport,
  show,
  status,
  UsageError,
  up,
  verb,
} from "./factory-commands.ts";
import { factoryLocale, type Words, words } from "./words.ts";

export { ExitCode };

/** The model review and verify sessions use unless --model names another. */
const defaultSessionModel = "claude-sonnet-5-5";

export interface Output {
  stdout(line: string): void;
  stderr(line: string): void;
  /** Write text to stdout or stderr as is, without adding a line break. */
  rawStdout(text: string): void;
  rawStderr(text: string): void;
}

/** The usage text in `locale`. */
export const usageText = (locale: Locale) => words(locale)("cli.usage");

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
  const t = words(await factoryLocale());
  try {
    if (command === "gates") return await gates(rest, out, cwd, t);
    if (command === "diff-guard") return await diffGuard(rest, out, cwd, t);
    if (command === "prove") return await prove(rest, out, cwd, t);
    if (command === "review") return await review(rest, out, cwd, t);
    if (command === "verify") return await verify(rest, out, cwd, t);
    if (command === "up") return await up(rest, out, t);
    if (command === "down") return await down(rest, out, t);
    if (command === "status") return await status(rest, out, t);
    if (command === "add") return await add(rest, out, t);
    if (command === "ls") return await ls(rest, out, t);
    if (command === "show") return await show(rest, out, t);
    if (command === "admin") return await admin(rest, out, t);
    if (command === "check") return await check(rest, out, t);
    if (command === "dashboard") return await dashboard(rest, out, t);
    if (command === "report") return await metricsReport(rest, out, t);
    const named = verbSchema.options.find((name) => name === command);
    if (named) return await verb(named, rest, out, t);
  } catch (error) {
    const fromParseArgs = String((error as { code?: unknown }).code).startsWith("ERR_PARSE_ARGS");
    if (error instanceof UsageError || fromParseArgs) {
      return usage(out, (error as Error).message, t);
    }
    throw error;
  }
  return usage(out, command === undefined ? undefined : t("cli.unknown-command", { command }), t);
}

// With --json, stdout carries only the JSON document, so progress output goes to stderr.
function logTo(out: Output, json: boolean | undefined) {
  return json ? out.rawStderr : out.rawStdout;
}

/** Prints the result: the JSON document with --json, otherwise `details` and then `line`. */
function report(
  out: Output,
  json: boolean | undefined,
  result: object,
  line: string,
  details: readonly string[] = [],
) {
  if (json) {
    out.stdout(JSON.stringify({ ...result, line }));
    return;
  }
  for (const detail of details) out.stdout(detail);
  out.stdout(line);
}

async function gates(args: readonly string[], out: Output, cwd: string, t: Words): Promise<number> {
  const { values } = parseArgs({
    args: [...args],
    options: {
      level: { type: "string", default: "full" },
      base: { type: "string" },
      json: { type: "boolean" },
    },
    strict: true,
  });
  const level = gateLevelSchema.safeParse(values.level);
  if (!level.success)
    throw new UsageError(t("cli.unknown-gate-level", { level: String(values.level) }));

  const result = await runGates({
    cwd,
    level: level.data,
    base: values.base,
    log: logTo(out, values.json),
  });
  report(out, values.json, result, gatesLine(result));
  return result.status === "pass" ? ExitCode.success : ExitCode.failure;
}

async function diffGuard(
  args: readonly string[],
  out: Output,
  cwd: string,
  t: Words,
): Promise<number> {
  const { values } = parseArgs({
    args: [...args],
    options: {
      base: { type: "string" },
      head: { type: "string", default: "HEAD" },
      scope: { type: "string", multiple: true },
      json: { type: "boolean" },
    },
    strict: true,
  });
  if (values.base === undefined)
    throw new UsageError(t("cli.needs-base", { command: "diff-guard" }));

  const result = await runDiffGuard({
    cwd,
    base: values.base,
    head: values.head,
    scope: values.scope,
    log: logTo(out, values.json),
  });
  report(out, values.json, result, diffGuardLine(result));
  return result.status === "pass" ? ExitCode.success : ExitCode.failure;
}

async function prove(args: readonly string[], out: Output, cwd: string, t: Words): Promise<number> {
  const { values } = parseArgs({
    args: [...args],
    options: {
      base: { type: "string" },
      preserve: { type: "boolean" },
      json: { type: "boolean" },
    },
    strict: true,
  });
  if (values.base === undefined) throw new UsageError(t("cli.needs-base", { command: "prove" }));

  const result = await runProve({
    cwd,
    base: values.base,
    mode: values.preserve ? "preserve" : "reproduce",
    log: logTo(out, values.json),
  });
  report(out, values.json, result, proveLine(result));
  return result.status === "pass" ? ExitCode.success : ExitCode.failure;
}

/** Parses the arguments that review and verify share; null means claude is not on PATH. */
function sessionArgs(command: string, args: readonly string[], defaultCost: string, t: Words) {
  const { values } = parseArgs({
    args: [...args],
    options: {
      base: { type: "string" },
      goal: { type: "string" },
      "done-when": { type: "string", multiple: true },
      model: { type: "string", default: defaultSessionModel },
      "max-cost": { type: "string", default: defaultCost },
      out: { type: "string" },
      json: { type: "boolean" },
    },
    strict: true,
  });
  const doneWhen = values["done-when"] ?? [];
  if (values.base === undefined || values.goal === undefined || doneWhen.length === 0) {
    throw new UsageError(t("cli.needs-session-options", { command }));
  }
  const maxCostUsd = Number(values["max-cost"]);
  if (!(maxCostUsd > 0)) throw new UsageError(t("cli.max-cost"));
  const executable = Bun.which("claude");
  if (executable === null) return null;
  return {
    base: values.base,
    goal: values.goal,
    doneWhen,
    model: values.model,
    maxCostUsd,
    out: values.out,
    json: values.json,
    executable,
  };
}

async function review(
  args: readonly string[],
  out: Output,
  cwd: string,
  t: Words,
): Promise<number> {
  const values = sessionArgs("review", args, "1", t);
  if (values === null) return missingClaude(out, "review", t);
  const result = await runReview({
    ...values,
    cwd,
    judge: claudeJudge(values.executable),
    log: logTo(out, values.json),
  });
  if (result.status === "reviewed" && values.out !== undefined) {
    try {
      await writeReviewVerdict(values.out, result.record);
    } catch (error) {
      out.stderr(`kozo: ${(error as Error).message}`);
      return ExitCode.failure;
    }
  }
  const details =
    result.status === "reviewed"
      ? [
          result.record.summary,
          ...result.record.findings.map((finding) => {
            const where = finding.path ? ` ${finding.path}:` : "";
            return `- [${finding.severity}] ${finding.criterion}:${where} ${finding.issue}`;
          }),
        ]
      : [];
  report(out, values.json, result, reviewLine(result), details);
  if (result.status === "error") return ExitCode.failure;
  const codes = {
    accept: ExitCode.success,
    revise: ExitCode.failure,
    escalate: ExitCode.awaitingHuman,
  };
  return codes[result.record.verdict];
}

async function verify(
  args: readonly string[],
  out: Output,
  cwd: string,
  t: Words,
): Promise<number> {
  const values = sessionArgs("verify", args, "3", t);
  if (values === null) return missingClaude(out, "verify", t);
  const result = await runVerify({
    ...values,
    cwd,
    verifier: claudeVerifier(values.executable, kozoHome().root),
    log: logTo(out, values.json),
  });
  if (result.status === "verified" && values.out !== undefined) {
    try {
      await writeVerifyVerdict(values.out, cwd, result.record);
    } catch (error) {
      out.stderr(`kozo: ${(error as Error).message}`);
      return ExitCode.failure;
    }
  }
  const details =
    result.status === "verified"
      ? [
          result.record.summary,
          ...result.record.conditions.map((condition) => {
            const mark = condition.met ? t("cli.condition-met") : t("cli.condition-not-met");
            return `- [${mark}] ${condition.condition}: ${condition.observation}`;
          }),
        ]
      : [];
  report(out, values.json, result, verifyLine(result), details);
  if (result.status !== "verified") return ExitCode.failure;
  const codes = { pass: ExitCode.success, fail: ExitCode.failure, blocked: ExitCode.awaitingHuman };
  return codes[result.record.result];
}

function missingClaude(out: Output, command: string, t: Words): number {
  out.stderr(`kozo: ${t("cli.needs-claude", { command })}`);
  return ExitCode.failure;
}

function usage(out: Output, problem: string | undefined, t: Words): number {
  const text = t("cli.usage");
  out.stderr(problem === undefined ? text : `kozo: ${problem}\n\n${text}`);
  return ExitCode.usage;
}
