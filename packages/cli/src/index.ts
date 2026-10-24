import { parseArgs } from "node:util";
import { gateLevelSchema } from "@kozo/core";
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

const USAGE = `Usage: kozo <command>

Commands:
  up | down [--json]
      Start kozod in the background, or stop it
  status [--line] [--json]
      kozod's state, mode, runs, the inbox count and today's cost; --line
      prints one line for a status bar
  add <text> [--repo <path>] [--class <class>] [-f <file>] [--json]
      Add an item; the first line is its title and the rest, with the
      file's text, its body
  ls [inbox|items|tasks|runs] [--json]
      List what waits for you (the default) or every item, task or run
  show <ref> [-f] [--diff] [--json]
      Show an item, task or run; -f follows its events, and --diff prints a
      task's diff against the default branch
  say <ref> <text>          Answer a question or instruct a run or task
  say --ask <ref> <question>
      Ask about an item, task or run; the explorer answers from the records
      without touching the work
  approve <item> [text]     Approve a start or a plan
  reject <item> <reason>    Reject a plan
  pause [ref] [--now] | resume [ref]
      Stop or resume the whole factory, or one item, task or run
  retry <ref> [text]        Retry a task from its checkpoint or an item
  close <ref> --done | --cancel <reason>
      Complete an item or task that needed no change, or cancel it
  reorder <item> [--before <item>]
      Move an item before another in the order kozod starts work, or to the end
  issue <item>              In GitHub mode, move a local item without tasks to an
      Issue of its repository, which kozod then takes up
  take <task>               Take a task over and work in its worktree
  return <task> <text>      Give a taken task back once your work is committed;
      its checks run on your commits from the deterministic ones on
  report [--days <n>] [--review | --cost] [--json]
      The metrics and failures over the last <n> days (default 30) and the
      promotion proposals; --review adds each class's level, the demotions
      and the cost, --cost shows each day's cost against the budget
  dashboard [--url] [--json]
      Open the dashboard in the browser, or print its URL with --url; the URL
      opens a session once, within a minute
  check [path] [--json]
      Check the factory definition, each repository's Charter, claude and the
      sandbox; with a path, only the definition or .kozo/ in that directory
  admin init [--json]       Create the factory definition from kozo's template
  admin install <path> [--json]
      Add kozo's files to a repository; in GitHub mode kozod opens them as a
      pull request
  admin db-rebuild          Rebuild kozo.db from the event logs
  admin eval add <run> [--json]
      Draft the eval case of a run's item into the factory definition's evals/
  admin eval run [<case>...] [--json]
      Run the eval cases, or the named ones, each in a throwaway factory home,
      and print the share that reached the expected outcome and the cost
  admin prune --older-than <days> [--dry-run] [--json]
      Remove all but the event log, report, verdicts and decision log of
      every run whose item closed at least <days> days ago

  gates [--level fast|full|deep] [--base <ref>] [--json]
      Run the gates of one level (default full); with --base, take the
      constraints from the tip of <ref> instead of the worktree
  diff-guard --base <ref> [--head <ref>] [--scope <glob>]... [--json]
      Check the diff from the merge base of <ref> to <head> (default HEAD)
      against the Charter and constraints at the tip of <ref>
  prove --base <ref> [--preserve] [--json]
      Require the changed tests to pass at HEAD and to fail with the
      non-test changes reverted in place; with --preserve, to pass reverted
      too, for a change that keeps behaviour; the worktree must be clean
  review --base <ref> --goal <text> --done-when <text>... [--model <id>]
         [--max-cost <usd>] [--out <dir>] [--json]
      Judge the diff from the merge base of <ref> to HEAD in a separate
      claude session that sees only the diff, GOAL and DONE_WHEN; with
      --out, record the verdict in <dir>/verdict.json
  verify --base <ref> --goal <text> --done-when <text>... [--model <id>]
         [--max-cost <usd>] [--out <dir>] [--json]
      Run the app by .kozo/verify-app.md at the tip of <ref> in a sandboxed
      claude session, exercise each DONE_WHEN condition and, with --out,
      record the verdict and copy the evidence into <dir>

Options:
  --version  Print the version

A <ref> of an item is K-<n> or <repo>#<n>, of a task <item>/t<n> and of a
run r-<nnnn>. Exit codes: 0 success, 1 failure, 2 usage error, 3 waiting
for a human, 4 not found.

A <ref> after --base or --head is a full commit ID, HEAD, a full ref such
as refs/remotes/origin/main, or a branch name, read as refs/heads/<name>.`;

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
  try {
    if (command === "gates") return await gates(rest, out, cwd);
    if (command === "diff-guard") return await diffGuard(rest, out, cwd);
    if (command === "prove") return await prove(rest, out, cwd);
    if (command === "review") return await review(rest, out, cwd);
    if (command === "verify") return await verify(rest, out, cwd);
    if (command === "up") return await up(rest, out);
    if (command === "down") return await down(rest, out);
    if (command === "status") return await status(rest, out);
    if (command === "add") return await add(rest, out);
    if (command === "ls") return await ls(rest, out);
    if (command === "show") return await show(rest, out);
    if (command === "admin") return await admin(rest, out);
    if (command === "check") return await check(rest, out);
    if (command === "dashboard") return await dashboard(rest, out);
    if (command === "report") return await metricsReport(rest, out);
    const verbs = [
      "say",
      "approve",
      "reject",
      "pause",
      "resume",
      "retry",
      "close",
      "take",
      "return",
      "reorder",
      "issue",
    ] as const;
    const named = verbs.find((name) => name === command);
    if (named) return await verb(named, rest, out);
  } catch (error) {
    const fromParseArgs = String((error as { code?: unknown }).code).startsWith("ERR_PARSE_ARGS");
    if (error instanceof UsageError || fromParseArgs) return usage(out, (error as Error).message);
    throw error;
  }
  return usage(out, command === undefined ? undefined : `unknown command '${command}'`);
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

async function gates(args: readonly string[], out: Output, cwd: string): Promise<number> {
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
  if (!level.success) throw new UsageError(`unknown gate level '${values.level}'`);

  const result = await runGates({
    cwd,
    level: level.data,
    base: values.base,
    log: logTo(out, values.json),
  });
  report(out, values.json, result, gatesLine(result));
  return result.status === "pass" ? ExitCode.success : ExitCode.failure;
}

async function diffGuard(args: readonly string[], out: Output, cwd: string): Promise<number> {
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
  if (values.base === undefined) throw new UsageError("diff-guard needs --base <ref>");

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

async function prove(args: readonly string[], out: Output, cwd: string): Promise<number> {
  const { values } = parseArgs({
    args: [...args],
    options: {
      base: { type: "string" },
      preserve: { type: "boolean" },
      json: { type: "boolean" },
    },
    strict: true,
  });
  if (values.base === undefined) throw new UsageError("prove needs --base <ref>");

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
function sessionArgs(command: string, args: readonly string[], defaultCost: string) {
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
    throw new UsageError(
      `${command} needs --base <ref>, --goal <text> and at least one --done-when <text>`,
    );
  }
  const maxCostUsd = Number(values["max-cost"]);
  if (!(maxCostUsd > 0)) throw new UsageError("--max-cost must be a positive number of US dollars");
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

async function review(args: readonly string[], out: Output, cwd: string): Promise<number> {
  const values = sessionArgs("review", args, "1");
  if (values === null) return missingClaude(out, "review");
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

async function verify(args: readonly string[], out: Output, cwd: string): Promise<number> {
  const values = sessionArgs("verify", args, "3");
  if (values === null) return missingClaude(out, "verify");
  const result = await runVerify({
    ...values,
    cwd,
    verifier: claudeVerifier(values.executable),
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
            const mark = condition.met ? "met" : "not met";
            return `- [${mark}] ${condition.condition}: ${condition.observation}`;
          }),
        ]
      : [];
  report(out, values.json, result, verifyLine(result), details);
  if (result.status !== "verified") return ExitCode.failure;
  const codes = { pass: ExitCode.success, fail: ExitCode.failure, blocked: ExitCode.awaitingHuman };
  return codes[result.record.result];
}

function missingClaude(out: Output, command: string): number {
  out.stderr(`kozo: ${command} needs the claude CLI on PATH`);
  return ExitCode.failure;
}

function usage(out: Output, problem: string | undefined): number {
  out.stderr(problem === undefined ? USAGE : `kozo: ${problem}\n\n${USAGE}`);
  return ExitCode.usage;
}
