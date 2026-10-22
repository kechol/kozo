import { type ReviewRecord, reviewJudgmentJsonSchema, reviewJudgmentSchema } from "@kozo/core";
import reviewDefinition from "../../../templates/factory/agents/review/agent.md" with {
  type: "text",
};
import { parseAgentDefinition } from "./agent-definition.ts";
import { diffCommand, resolveRange } from "./changes.ts";
import { guarded } from "./command.ts";
import { GitError, git } from "./git.ts";
import {
  defuseSections,
  type Judge,
  ownerNotesSection,
  parseAnswer,
  SessionError,
  type Spend,
  spending,
} from "./judge.ts";
import { updateVerdictFile } from "./verdict-file.ts";

export const reviewAgent = parseAgentDefinition(reviewDefinition);

export interface ReviewOptions {
  cwd: string;
  base: string;
  goal: string;
  doneWhen: readonly string[];
  /** What the owner said about the task since it was planned, such as an answer to a question. */
  ownerNotes?: readonly string[];
  judge: Judge;
  model: string;
  /** The review agent's instructions; kozod passes its factory definition's. */
  instructions?: string;
  maxCostUsd: number;
  log(text: string): void;
}

export type ReviewResult =
  | { status: "reviewed"; record: ReviewRecord }
  | { status: "error"; message: string; costUsd: number };

/** Runs review on the diff from the merge base with `base` to HEAD; the verdict is advice. */
export async function runReview(options: ReviewOptions): Promise<ReviewResult> {
  const spend: Spend = { usd: 0 };
  const result = await guarded(options.log, [GitError, SessionError], async () => ({
    status: "reviewed" as const,
    record: await review(options, spend),
  }));
  return result.status === "error" ? { ...result, costUsd: spend.usd } : result;
}

async function review(options: ReviewOptions, spend: Spend): Promise<ReviewRecord> {
  const { cwd, judge, model } = options;
  const { head, mergeBase: base } = await resolveRange(cwd, options.base, "HEAD");
  const diff = await git(cwd, [...(await diffCommand(cwd)), "-U5", base, head, "--"]);
  if (diff.trim() === "") throw new SessionError("there is no diff to review");

  const answer = await spending(
    spend,
    judge.judge({
      instructions: options.instructions ?? reviewAgent.instructions,
      prompt: reviewPrompt(options.goal, options.doneWhen, diff, options.ownerNotes),
      schema: reviewJudgmentJsonSchema,
      model,
      maxCostUsd: options.maxCostUsd,
    }),
  );
  const judgment = parseAnswer(reviewJudgmentSchema, "review", answer.output);
  const blocking = judgment.findings.some((finding) => finding.severity === "blocking");
  if (judgment.verdict === "accept" && blocking) {
    throw new SessionError("the review accepted the diff despite a blocking finding");
  }
  return {
    ...judgment,
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
export function reviewPrompt(
  goal: string,
  doneWhen: readonly string[],
  diff: string,
  ownerNotes: readonly string[] = [],
): string {
  const defuse = (text: string) => defuseSections(text, ["instructions", "diff"]);
  const conditions = doneWhen.map((condition) => `- ${defuse(condition)}`).join("\n");
  return [
    "<instructions>",
    `GOAL: ${defuse(goal)}`,
    "DONE_WHEN:",
    conditions,
    ...ownerNotesSection(ownerNotes, defuse),
    "</instructions>",
    "",
    '<diff trust="untrusted">',
    defuse(diff).trimEnd(),
    "</diff>",
  ].join("\n");
}

/** Records the review in `<dir>/verdict.json`, keeping the other judges' verdicts there. */
export async function writeReviewVerdict(dir: string, record: ReviewRecord): Promise<string> {
  return await updateVerdictFile(dir, { review: record });
}

/** The single line by which kozod reads the review; it is always the last line printed. */
export function reviewLine(result: ReviewResult): string {
  if (result.status === "error") return "KOZO_REVIEW: status=error";
  const { verdict, findings, model, costUsd } = result.record;
  const blocking = findings.filter((finding) => finding.severity === "blocking").length;
  return `KOZO_REVIEW: status=reviewed verdict=${verdict} findings=${findings.length} blocking=${blocking} model=${model} cost=${costUsd.toFixed(4)}`;
}
