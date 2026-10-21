import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  type ReviewRecord,
  reviewJudgmentJsonSchema,
  reviewJudgmentSchema,
  type VerdictFile,
  verdictFileSchema,
} from "@kozo/core";
import reviewDefinition from "../../../templates/factory/agents/review/agent.md" with {
  type: "text",
};
import { parseAgentDefinition } from "./agent-definition.ts";
import { diffCommand, resolveBase, resolveCommit } from "./changes.ts";
import { GitError, git } from "./git.ts";
import { type Judge, SessionError } from "./judge.ts";

export const reviewAgent = parseAgentDefinition(reviewDefinition);

export interface ReviewOptions {
  cwd: string;
  base: string;
  goal: string;
  doneWhen: readonly string[];
  judge: Judge;
  model: string;
  maxCostUsd: number;
  log(text: string): void;
}

export type ReviewResult =
  | { status: "reviewed"; record: ReviewRecord }
  | { status: "error"; message: string };

/** Runs review on the diff from the merge base with `base` to HEAD; the verdict is advice. */
export async function runReview(options: ReviewOptions): Promise<ReviewResult> {
  try {
    return { status: "reviewed", record: await review(options) };
  } catch (error) {
    if (!(error instanceof GitError || error instanceof SessionError)) throw error;
    options.log(`kozo: ${error.message}\n`);
    return { status: "error", message: error.message };
  }
}

async function review(options: ReviewOptions): Promise<ReviewRecord> {
  const { cwd, judge, model } = options;
  const head = await resolveCommit(cwd, "HEAD");
  const base = (await git(cwd, ["merge-base", await resolveBase(cwd, options.base), head])).trim();
  const diff = await git(cwd, [...(await diffCommand(cwd)), "-U5", base, head, "--"]);
  if (diff.trim() === "") throw new SessionError("there is no diff to review");

  const answer = await judge.judge({
    instructions: reviewAgent.instructions,
    prompt: reviewPrompt(options.goal, options.doneWhen, diff),
    schema: reviewJudgmentJsonSchema,
    model,
    maxCostUsd: options.maxCostUsd,
  });
  const judgment = reviewJudgmentSchema.safeParse(answer.output);
  if (!judgment.success) {
    throw new SessionError(
      `the review answer does not match its schema: ${judgment.error.message}`,
    );
  }
  const blocking = judgment.data.findings.some((finding) => finding.severity === "blocking");
  if (judgment.data.verdict === "accept" && blocking) {
    throw new SessionError("the review accepted the diff despite a blocking finding");
  }
  return {
    ...judgment.data,
    model: answer.model,
    costUsd: answer.costUsd,
    base,
    head,
    reviewedAt: new Date().toISOString(),
  };
}

/**
 * Builds the judge's prompt from the instructions and the diff alone. The diff is untrusted, so
 * anything in it that would close its section is defused first.
 */
export function reviewPrompt(goal: string, doneWhen: readonly string[], diff: string): string {
  const defuse = (text: string) => text.replace(/<\/(instructions|diff)/gi, "<\\/$1");
  const conditions = doneWhen.map((condition) => `- ${defuse(condition)}`).join("\n");
  return [
    "<instructions>",
    `GOAL: ${defuse(goal)}`,
    "DONE_WHEN:",
    conditions,
    "</instructions>",
    "",
    '<diff trust="untrusted">',
    defuse(diff).trimEnd(),
    "</diff>",
  ].join("\n");
}

/** Records the review in `<dir>/verdict.json`, keeping the other judges' verdicts there. */
export async function writeReviewVerdict(dir: string, record: ReviewRecord): Promise<string> {
  const path = join(dir, "verdict.json");
  const file = Bun.file(path);
  const existing: VerdictFile = (await file.exists())
    ? verdictFileSchema.parse(await file.json())
    : { version: 1 };
  await mkdir(dir, { recursive: true });
  await Bun.write(
    path,
    `${JSON.stringify(verdictFileSchema.parse({ ...existing, review: record }), null, 2)}\n`,
  );
  return path;
}

/** The single line by which kozod reads the review; it is always the last line printed. */
export function reviewLine(result: ReviewResult): string {
  if (result.status === "error") return "KOZO_REVIEW: status=error";
  const { verdict, findings, model, costUsd } = result.record;
  const blocking = findings.filter((finding) => finding.severity === "blocking").length;
  return `KOZO_REVIEW: status=reviewed verdict=${verdict} findings=${findings.length} blocking=${blocking} model=${model} cost=${costUsd.toFixed(4)}`;
}
