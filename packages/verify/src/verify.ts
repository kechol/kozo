import { constants } from "node:fs";
import { mkdir, open, realpath, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  message,
  type VerifyRecord,
  verifyJudgmentJsonSchema,
  verifyJudgmentSchema,
} from "@kozo/core";
import verifyDefinition from "../../../templates/factory/agents/verify/agent.md" with {
  type: "text",
};
import verifyAppSkill from "../../../templates/factory/skills/verify-app/SKILL.md" with {
  type: "text",
};
import {
  type AgentDefinition,
  parseAgentDefinition,
  parseSkill,
  type Skill,
} from "./agent-definition.ts";
import { resolveRef } from "./changes.ts";
import { guarded } from "./command.ts";
import { GitError, showFile } from "./git.ts";
import {
  defuseSections,
  ownerNotesSection,
  parseAnswer,
  type SessionAnswer,
  SessionError,
  SessionStopped,
  type Spend,
  spending,
  type Verifier,
} from "./judge.ts";
import { ProcessError, runningProcesses, stopProcessesIn } from "./processes.ts";
import { updateVerdictFile } from "./verdict-file.ts";

export const verifyAgent = parseAgentDefinition(verifyDefinition);
export const verifyAppSkillDefinition = parseSkill(verifyAppSkill);

/** What a verify session is told: the agent's instructions, then the verify-app skill. */
export const verifyInstructions = (agent: AgentDefinition, skill: Skill) =>
  `${agent.instructions}\n\n# Skill: verify-app\n\n${skill.instructions}`;
export const verifyAppPath = ".kozo/verify-app.md";

export interface VerifyOptions {
  cwd: string;
  base: string;
  goal: string;
  doneWhen: readonly string[];
  /** What the owner said about the task since it was planned, such as an answer to a question. */
  ownerNotes?: readonly string[];
  /** What the judge is told about the language of its prose, if anything. */
  language?: string | null;
  verifier: Verifier;
  model: string;
  /** The verify agent's instructions with the verify-app skill; kozod passes its definition's. */
  instructions?: string;
  maxCostUsd: number;
  /** Stops the session; a stop before the answer throws SessionStopped. */
  signal?: AbortSignal;
  log(text: string): void;
}

export type VerifyResult =
  | { status: "verified"; record: VerifyRecord }
  | { status: "MISCONFIGURED"; reason: "verify-app-missing" }
  | { status: "error"; message: string; costUsd: number };

/**
 * Runs the verify agent in the worktree at `cwd`. The procedure comes from `.kozo/verify-app.md`
 * at the tip of `base`, like the Charter, so the diff under check cannot rewrite it.
 */
export async function runVerify(options: VerifyOptions): Promise<VerifyResult> {
  const spend: Spend = { usd: 0 };
  const result = await guarded(options.log, [GitError, SessionError, ProcessError], () =>
    verify(options, spend),
  );
  if (result.status === "error" && options.signal?.aborted)
    throw new SessionStopped("verify", spend.usd);
  return result.status === "error" ? { ...result, costUsd: spend.usd } : result;
}

async function verify(options: VerifyOptions, spend: Spend): Promise<VerifyResult> {
  const { cwd, log } = options;
  const procedure = await showFile(cwd, await resolveRef(cwd, options.base), verifyAppPath);
  if (procedure === null) {
    log(`kozo: ${verifyAppPath} is missing at ${options.base}\n`);
    return { status: "MISCONFIGURED", reason: "verify-app-missing" };
  }
  const head = await resolveRef(cwd, "HEAD");
  const before = await runningProcesses();
  let answer: SessionAnswer;
  try {
    answer = await spending(
      spend,
      options.verifier.verify({
        cwd,
        instructions:
          options.instructions ?? verifyInstructions(verifyAgent, verifyAppSkillDefinition),
        prompt: verifyPrompt(
          options.goal,
          options.doneWhen,
          procedure,
          options.ownerNotes,
          options.language,
        ),
        schema: verifyJudgmentJsonSchema,
        model: options.model,
        maxCostUsd: options.maxCostUsd,
        ...(options.signal ? { signal: options.signal } : {}),
      }),
    );
  } finally {
    const stopped = await stopProcessesIn(cwd, before);
    if (stopped.length > 0)
      log(`kozo: stopped processes left in the worktree: ${stopped.join(", ")}\n`);
  }
  const judgment = parseAnswer(verifyJudgmentSchema, "verify", answer.output);
  const { result, conditions } = judgment;
  if (conditions.length !== options.doneWhen.length) {
    throw new SessionError(
      message("session.conditions-count", {
        count: conditions.length,
        expected: options.doneWhen.length,
      }),
    );
  }
  const reordered = conditions.findIndex(
    (condition, index) => condition.condition.trim() !== options.doneWhen[index]?.trim(),
  );
  if (reordered !== -1) {
    throw new SessionError(message("session.condition-order", { index: reordered + 1 }));
  }
  if (result === "pass" && conditions.some((condition) => !condition.met)) {
    throw new SessionError(message("session.pass-unmet"));
  }
  const unproven = conditions.findIndex(
    (condition) => condition.met && condition.evidence.length === 0,
  );
  if (unproven !== -1) {
    throw new SessionError(message("session.no-evidence", { index: unproven + 1 }));
  }
  if (result === "pass" && !judgment.cleanedUp) {
    throw new SessionError(message("session.not-cleaned"));
  }
  for (const path of conditions.flatMap((condition) => condition.evidence)) {
    await resolveEvidence(cwd, path);
  }
  const record: VerifyRecord = {
    ...judgment,
    model: answer.model,
    costUsd: answer.costUsd,
    head,
    verifiedAt: new Date().toISOString(),
  };
  return { status: "verified", record };
}

/**
 * Builds the verify agent's prompt; the procedure is the repository's, read at the base tip. The
 * goal and conditions come from a request, so nothing in them may close a section.
 */
export function verifyPrompt(
  goal: string,
  doneWhen: readonly string[],
  procedure: string,
  ownerNotes: readonly string[] = [],
  language: string | null = null,
): string {
  const defuse = (text: string) => defuseSections(text, ["instructions", "verify-app"]);
  return [
    "<instructions>",
    `GOAL: ${defuse(goal)}`,
    "DONE_WHEN:",
    ...doneWhen.map((condition) => `- ${defuse(condition)}`),
    ...ownerNotesSection(ownerNotes, defuse),
    ...(language ? [`LANGUAGE: ${language}`] : []),
    "</instructions>",
    "",
    "<verify-app>",
    defuse(procedure).trimEnd(),
    "</verify-app>",
  ].join("\n");
}

/**
 * Records the verify verdict in `<dir>/verdict.json` and copies its evidence files from the
 * worktree into `<dir>/evidence/`. Evidence paths that leave the worktree are refused, and so is
 * a `dir` inside the worktree, where the session could have planted links to redirect the writes.
 */
export async function writeVerifyVerdict(
  dir: string,
  cwd: string,
  record: VerifyRecord,
): Promise<string> {
  const root = await realpath(cwd);
  // Checked before anything is created, against the deepest part of the path that exists.
  if (isInside(root, await realpathOfExisting(dir))) {
    throw new SessionError(message("session.verdict-inside"));
  }
  await mkdir(dir, { recursive: true });
  if (isInside(root, await realpath(dir))) {
    throw new SessionError(message("session.verdict-inside"));
  }
  for (const path of record.conditions.flatMap((condition) => condition.evidence)) {
    const { source, inside, identity } = await resolveEvidence(cwd, path);
    // The file is opened without following a final link and must still be the file resolved
    // above, so a link swapped in after the check cannot redirect the copy.
    const handle = await open(source, constants.O_RDONLY | constants.O_NOFOLLOW).catch(() => null);
    if (handle === null) throw new SessionError(message("session.evidence-changed", { path }));
    try {
      const opened = await handle.stat();
      const same = opened.ino === identity.ino && opened.dev === identity.dev;
      if (!opened.isFile() || opened.nlink !== 1 || !same) {
        throw new SessionError(message("session.evidence-changed", { path }));
      }
      const target = join(dir, "evidence", inside);
      await mkdir(dirname(target), { recursive: true });
      await Bun.write(target, await handle.readFile());
    } finally {
      await handle.close();
    }
  }
  return await updateVerdictFile(dir, { verify: record });
}

/** Resolves an evidence path, following links, and refuses one that is missing or leaves `cwd`. */
async function resolveEvidence(cwd: string, path: string) {
  const root = await realpath(cwd);
  const source = await realpath(join(root, path)).catch(() => null);
  if (source === null) throw new SessionError(message("session.evidence-missing", { path }));
  if (!isInside(root, source)) {
    throw new SessionError(message("session.evidence-outside", { path }));
  }
  const inside = relative(root, source);
  const identity = await stat(source);
  // A hard link would let a file elsewhere on the machine pose as one inside the worktree.
  if (!identity.isFile() || identity.nlink !== 1) {
    throw new SessionError(message("session.evidence-not-file", { path }));
  }
  return { source, inside, identity };
}

/** Whether `path` is `root` or lies under it, compared by path components, not by prefix. */
export function isInside(root: string, path: string) {
  const rest = relative(root, path);
  return rest === "" || (!isAbsolute(rest) && rest.split(sep)[0] !== "..");
}

/** The real path of `path`, or of its deepest ancestor that exists, with the rest appended. */
async function realpathOfExisting(path: string): Promise<string> {
  const absolute = resolve(path);
  const real = await realpath(absolute).catch(() => null);
  if (real !== null) return real;
  const parent = dirname(absolute);
  if (parent === absolute) return absolute;
  return join(await realpathOfExisting(parent), basename(absolute));
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
