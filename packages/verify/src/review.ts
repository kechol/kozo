import {
  message,
  type ReviewRecord,
  reviewJudgmentJsonSchema,
  reviewJudgmentSchema,
} from "@kozo/core";
import reviewDefinition from "../../../templates/factory/agents/review/agent.md" with {
  type: "text",
};
import { parseAgentDefinition } from "./agent-definition.ts";
import { diffCommand, resolveRange, resolveRef } from "./changes.ts";
import { guarded } from "./command.ts";
import { GitError, git, showFile } from "./git.ts";
import {
  defuseSections,
  type Judge,
  ownerNotesSection,
  parseAnswer,
  SessionError,
  SessionStopped,
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
  /** What the judge is told about the language of its prose, if anything. */
  language?: string | null;
  /** How the plan makes the item's change; it was drafted from the request, so it is data. */
  approach?: string | null;
  /** The plan's shared agreements, data like the approach. */
  shared?: readonly string[];
  judge: Judge;
  model: string;
  /** The review agent's instructions; kozod passes its factory definition's. */
  instructions?: string;
  maxCostUsd: number;
  /** Stops the session; a stop before the verdict throws SessionStopped. */
  signal?: AbortSignal;
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
  if (result.status === "error" && options.signal?.aborted)
    throw new SessionStopped("review", spend.usd);
  return result.status === "error" ? { ...result, costUsd: spend.usd } : result;
}

async function review(options: ReviewOptions, spend: Spend): Promise<ReviewRecord> {
  const { cwd, judge, model } = options;
  const { head, mergeBase: base } = await resolveRange(cwd, options.base, "HEAD");
  const diff = await git(cwd, [...(await diffCommand(cwd)), "-U5", base, head, "--"]);
  if (diff.trim() === "") throw new SessionError(message("session.no-diff"));
  const shown = capDiff(diff);
  // The rules come from the base's tip, as the Charter does, so the diff under review cannot
  // rewrite what it is judged against.
  const rules = await showFile(cwd, await resolveRef(cwd, options.base), rulesPath);

  const answer = await spending(
    spend,
    judge.judge({
      instructions: options.instructions ?? reviewAgent.instructions,
      prompt: reviewPrompt(
        options.goal,
        options.doneWhen,
        shown.diff,
        options.ownerNotes,
        shown.unseen,
        options.language,
        { rules, approach: options.approach ?? null, shared: options.shared ?? [] },
      ),
      schema: reviewJudgmentJsonSchema,
      model,
      maxCostUsd: options.maxCostUsd,
      ...(options.signal ? { signal: options.signal } : {}),
    }),
  );
  const judgment = parseAnswer(reviewJudgmentSchema, "review", answer.output);
  const blocking = judgment.findings.some((finding) => finding.severity === "blocking");
  if (judgment.verdict === "accept" && blocking) {
    throw new SessionError(message("session.accept-blocking"));
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

// The repository's rules that review judges conventions against, and how much of them it reads:
// enough for any AGENTS.md written for people, while one grown past it cannot crowd out the diff.
const rulesPath = "AGENTS.md";
const rulesLimit = 12_000;

// How much of a diff the judge reads: enough for any change a task makes by hand, while a
// lockfile or a generated file would fill the session with lines nobody wrote. A lockfile is
// read like any file, since a changed source or checksum in it is a change to what runs.
const fileLimit = 400;
const totalLimit = 4_000;

/**
 * The part of a unified diff the judge reads: each file's diff up to 400 lines and 4,000 lines in
 * all, and a line for each file cut or left out saying what was not shown.
 */
export function capDiff(diff: string): { diff: string; unseen: string[] } {
  const files = diff.split(/^(?=diff --git )/m).filter((file) => file.trim() !== "");
  const shown: string[] = [];
  const unseen: string[] = [];
  let left = totalLimit;
  for (const file of files) {
    const lines = file.replace(/\n$/, "").split("\n");
    const path = /^diff --git a\/.* b\/(.*)$/.exec(lines[0] ?? "")?.[1] ?? "a file";
    const added = lines.filter((line) => line.startsWith("+") && !line.startsWith("+++")).length;
    const removed = lines.filter((line) => line.startsWith("-") && !line.startsWith("---")).length;
    const size = `+${added} -${removed}`;
    if (left === 0) {
      unseen.push(`${path} (${size}): not shown, past the ${totalLimit} lines in all`);
      continue;
    }
    const room = Math.min(fileLimit, left);
    shown.push(lines.slice(0, room).join("\n"));
    left -= Math.min(room, lines.length);
    if (lines.length > room)
      unseen.push(`${path} (${size}): only its first ${room} of ${lines.length} diff lines shown`);
  }
  return { diff: `${shown.join("\n")}\n`, unseen };
}

/**
 * Builds the judge's prompt from the instructions and the diff alone. The diff is untrusted, so
 * anything in it that would close its section is defused first. `unseen` names the parts of the
 * diff kozod left out, in the instructions, where the diff cannot forge them.
 */
export function reviewPrompt(
  goal: string,
  doneWhen: readonly string[],
  diff: string,
  ownerNotes: readonly string[] = [],
  unseen: readonly string[] = [],
  language: string | null = null,
  {
    rules = null,
    approach = null,
    shared = [],
  }: { rules?: string | null; approach?: string | null; shared?: readonly string[] } = {},
): string {
  const defuse = (text: string) => defuseSections(text, ["instructions", "approach", "diff"]);
  const shownRules =
    rules === null || rules.trim() === ""
      ? []
      : [
          `RULES: the repository's ${rulesPath} at the base, which the conventions criterion judges against:`,
          defuse(rules.slice(0, rulesLimit)).trimEnd(),
          ...(rules.length > rulesLimit
            ? [`RULES CUT: kozod showed the first ${rulesLimit} of its ${rules.length} characters.`]
            : []),
        ];
  const conditions = doneWhen.map((condition) => `- ${defuse(condition)}`).join("\n");
  const cut =
    unseen.length === 0
      ? []
      : [
          "NOT SHOWN: kozod left these parts of the diff out; judge what you see, and say in a finding when what is left out keeps you from judging a condition.",
          ...unseen.map((part) => `- ${defuse(part)}`),
        ];
  return [
    "<instructions>",
    `GOAL: ${defuse(goal)}`,
    "DONE_WHEN:",
    conditions,
    ...ownerNotesSection(ownerNotes, defuse),
    ...cut,
    ...(language ? [`LANGUAGE: ${language}`] : []),
    ...shownRules,
    "</instructions>",
    "",
    ...(approach || shared.length > 0
      ? [
          '<approach trust="untrusted">',
          ...(approach ? [defuse(approach).trimEnd()] : []),
          ...(shared.length > 0
            ? ["Shared by the item's tasks:", ...shared.map((line) => `- ${defuse(line)}`)]
            : []),
          "</approach>",
          "",
        ]
      : []),
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
