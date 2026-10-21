import { copyFile, mkdir, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, relative } from "node:path";
import {
  type VerdictFile,
  type VerifyRecord,
  verdictFileSchema,
  verifyJudgmentJsonSchema,
  verifyJudgmentSchema,
} from "@kozo/core";
import verifyDefinition from "../../../templates/factory/agents/verify/agent.md" with {
  type: "text",
};
import verifyAppSkill from "../../../templates/factory/skills/verify-app/SKILL.md" with {
  type: "text",
};
import { parseAgentDefinition, parseSkill } from "./agent-definition.ts";
import { resolveCommit } from "./changes.ts";
import { GitError, showFile } from "./git.ts";
import { SessionError, type Verifier } from "./judge.ts";
import { stopProcessesIn } from "./processes.ts";

export const verifyAgent = parseAgentDefinition(verifyDefinition);
export const verifyAppSkillDefinition = parseSkill(verifyAppSkill);
export const verifyAppPath = ".kozo/verify-app.md";

export interface VerifyOptions {
  cwd: string;
  base: string;
  goal: string;
  doneWhen: readonly string[];
  verifier: Verifier;
  model: string;
  maxCostUsd: number;
  log(text: string): void;
}

export type VerifyResult =
  | { status: "verified"; record: VerifyRecord }
  | { status: "MISCONFIGURED"; reason: "verify-app-missing" }
  | { status: "error"; message: string };

/**
 * Runs the verify agent in the worktree at `cwd`. The procedure comes from `.kozo/verify-app.md`
 * at the tip of `base`, like the Charter, so the diff under check cannot rewrite it.
 */
export async function runVerify(options: VerifyOptions): Promise<VerifyResult> {
  try {
    return await verify(options);
  } catch (error) {
    if (!(error instanceof GitError || error instanceof SessionError)) throw error;
    options.log(`kozo: ${error.message}\n`);
    return { status: "error", message: error.message };
  }
}

async function verify(options: VerifyOptions): Promise<VerifyResult> {
  const { cwd, log } = options;
  const procedure = await showFile(cwd, await resolveCommit(cwd, options.base), verifyAppPath);
  if (procedure === null) {
    log(`kozo: ${verifyAppPath} is missing at ${options.base}\n`);
    return { status: "MISCONFIGURED", reason: "verify-app-missing" };
  }
  const head = await resolveCommit(cwd, "HEAD");
  const started = new Date();
  let answer: Awaited<ReturnType<Verifier["verify"]>>;
  try {
    answer = await options.verifier.verify({
      cwd,
      instructions: `${verifyAgent.instructions}\n\n# Skill: verify-app\n\n${verifyAppSkillDefinition.instructions}`,
      prompt: verifyPrompt(options.goal, options.doneWhen, procedure),
      schema: verifyJudgmentJsonSchema,
      model: options.model,
      maxCostUsd: options.maxCostUsd,
    });
  } finally {
    const stopped = await stopProcessesIn(cwd, started);
    if (stopped.length > 0)
      log(`kozo: stopped processes left in the worktree: ${stopped.join(", ")}\n`);
  }
  const judgment = verifyJudgmentSchema.safeParse(answer.output);
  if (!judgment.success) {
    throw new SessionError(
      `the verify answer does not match its schema: ${judgment.error.message}`,
    );
  }
  const { result, conditions } = judgment.data;
  if (conditions.length !== options.doneWhen.length) {
    throw new SessionError(
      `the verify answer covers ${conditions.length} conditions, not the ${options.doneWhen.length} given`,
    );
  }
  if (result === "pass" && conditions.some((condition) => !condition.met)) {
    throw new SessionError("the verify answer passed with a condition that was not met");
  }
  for (const path of conditions.flatMap((condition) => condition.evidence)) {
    await resolveEvidence(cwd, path);
  }
  const record: VerifyRecord = {
    ...judgment.data,
    model: answer.model,
    costUsd: answer.costUsd,
    head,
    verifiedAt: new Date().toISOString(),
  };
  return { status: "verified", record };
}

/** Builds the verify agent's prompt; the procedure is the repository's, read at the base tip. */
export function verifyPrompt(goal: string, doneWhen: readonly string[], procedure: string): string {
  return [
    "<instructions>",
    `GOAL: ${goal}`,
    "DONE_WHEN:",
    ...doneWhen.map((condition) => `- ${condition}`),
    "</instructions>",
    "",
    "<verify-app>",
    procedure.trimEnd(),
    "</verify-app>",
  ].join("\n");
}

/**
 * Records the verify verdict in `<dir>/verdict.json` and copies its evidence files from the
 * worktree into `<dir>/evidence/`. Evidence paths that leave the worktree are refused.
 */
export async function writeVerifyVerdict(
  dir: string,
  cwd: string,
  record: VerifyRecord,
): Promise<string> {
  for (const path of record.conditions.flatMap((condition) => condition.evidence)) {
    const { source, inside } = await resolveEvidence(cwd, path);
    const target = join(dir, "evidence", inside);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(source, target);
  }
  const verdictPath = join(dir, "verdict.json");
  const file = Bun.file(verdictPath);
  const existing: VerdictFile = (await file.exists())
    ? verdictFileSchema.parse(await file.json())
    : { version: 1 };
  await Bun.write(
    verdictPath,
    `${JSON.stringify(verdictFileSchema.parse({ ...existing, verify: record }), null, 2)}\n`,
  );
  return verdictPath;
}

/** Resolves an evidence path, following links, and refuses one that is missing or leaves `cwd`. */
async function resolveEvidence(cwd: string, path: string) {
  const root = await realpath(cwd);
  const source = await realpath(join(root, path)).catch(() => null);
  if (source === null) throw new SessionError(`evidence file ${path} does not exist`);
  const inside = relative(root, source);
  if (inside.startsWith("..") || isAbsolute(inside)) {
    throw new SessionError(`evidence file ${path} is outside the worktree`);
  }
  return { source, inside };
}

/** The single line by which kozod reads verify; it is always the last line printed. */
export function verifyLine(result: VerifyResult): string {
  if (result.status === "error") return "KOZO_VERIFY: status=error";
  if (result.status === "MISCONFIGURED")
    return `KOZO_VERIFY: status=MISCONFIGURED reason=${result.reason}`;
  const { result: outcome, conditions, model, costUsd } = result.record;
  const met = conditions.filter((condition) => condition.met).length;
  const evidence = conditions.reduce((sum, condition) => sum + condition.evidence.length, 0);
  return `KOZO_VERIFY: status=verified result=${outcome} conditions=${conditions.length} met=${met} evidence=${evidence} model=${model} cost=${costUsd.toFixed(4)}`;
}
