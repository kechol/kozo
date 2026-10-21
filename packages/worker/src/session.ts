import {
  type BlockedReason,
  blockedReasonSchema,
  type GateLevel,
  gateLevelSchema,
} from "@kozo/core";
import { gatesLine, runGates } from "@kozo/verify";
import { z } from "zod";
import type {
  AgentOutcome,
  AgentRecord,
  AgentTool,
  CodingAgent,
  Instruction,
} from "./coding-agent.ts";
import { factoryGitEnvironment } from "./git-environment.ts";
import { guardToolCall } from "./guard.ts";
import type { SandboxPaths } from "./task-sandbox.ts";

/** Everything a worker needs to run one session, written by kozod into the run directory. */
export const workerSpecSchema = z.strictObject({
  version: z.literal(1),
  run: z.string(),
  agent: z.enum(["triage", "plan", "implement", "review", "verify", "explorer"]),
  model: z.string(),
  cwd: z.string(),
  instructions: z.string(),
  prompt: z.string(),
  outputSchema: z.record(z.string(), z.unknown()),
  maxTurns: z.int().positive(),
  maxCostUsd: z.number().positive(),
  /** The run's instruction queue, which only kozod appends to. */
  queue: z.string(),
  policy: z.strictObject({
    scope: z.array(z.string()),
    protectedPaths: z.array(z.string()),
    existingTests: z.array(z.string()),
    /** False for an agent that only reads, which may write nowhere. */
    writable: z.boolean(),
  }),
  sandbox: z.strictObject({
    denyRead: z.array(z.string()),
    allowRead: z.array(z.string()),
    allowWrite: z.array(z.string()),
    denyWrite: z.array(z.string()),
  }),
  /** The level the gates tool runs and stop-check requires; null offers no gates tool. */
  gates: gateLevelSchema.nullable(),
  /** The ref whose constraints the gates follow, the default branch. */
  base: z.string(),
  /** Whether stop-check requires at least one kozo_note. */
  requireNote: z.boolean(),
});
export type WorkerSpec = z.infer<typeof workerSpecSchema>;

export interface Blocked {
  reason: BlockedReason;
  question: string;
  split?: { goal: string; done_when: string[]; scope: string[] }[];
}

/** One line a worker writes to kozod on stdout. */
export type WorkerMessage =
  | { record: AgentRecord }
  | { note: string }
  | { blocked: Blocked }
  | { outcome: AgentOutcome };

/** The queue's entries after `delivered`, read again at every turn boundary. */
async function queued(path: string, delivered: number): Promise<Instruction[]> {
  const file = Bun.file(path);
  if (!(await file.exists())) return [];
  return (await file.text())
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line, seq) => ({
      seq,
      text: String((JSON.parse(line) as { text?: unknown }).text ?? ""),
    }))
    .filter((instruction) => instruction.seq > delivered);
}

const outputTail = (text: string, lines = 60) =>
  text.trimEnd().split("\n").slice(-lines).join("\n");

/**
 * Runs one session for a run: the guard and sandbox of its task, the agent tools, delivery of
 * queued instructions and stop-check. Every record, note and block goes to `emit`.
 */
export async function runSession(
  spec: WorkerSpec,
  agent: CodingAgent,
  emit: (message: WorkerMessage) => void,
  signal: AbortSignal,
): Promise<AgentOutcome> {
  let delivered = -1;
  let notes = 0;
  let blocked: Blocked | null = null;
  let gatesPassed = false;

  const tools: AgentTool[] = [
    {
      name: "kozo_note",
      description:
        "Record one decision in the run's decision log: what you chose and why. Use it for every choice a reviewer would want explained.",
      input: { choice: z.string().min(1), reason: z.string().min(1) },
      async run(input) {
        notes += 1;
        emit({ note: `${input.choice} — ${input.reason}` });
        return "Noted.";
      },
    },
    {
      name: "kozo_blocked",
      description:
        "Declare that you cannot go on: scope (the change does not fit the task; you may propose a split), ambiguous (the request can be read in more than one way), environment (something outside the code is broken) or missing-tool. Ask the owner one clear question.",
      input: {
        reason: blockedReasonSchema,
        question: z.string().min(1),
        split: z
          .array(
            z.object({
              goal: z.string().min(1),
              done_when: z.array(z.string().min(1)).min(1),
              scope: z.array(z.string().min(1)).min(1),
            }),
          )
          .optional(),
      },
      async run(input) {
        blocked = input as unknown as Blocked;
        emit({ blocked });
        return "Recorded. Finish now with a run report whose outcome is blocked, with this reason and question.";
      },
    },
  ];
  const level: GateLevel | null = spec.gates;
  if (level !== null) {
    tools.push({
      name: "gates",
      description: `Run the repository's ${level} gates on the worktree and get the result line and the failing output. The run cannot finish until they pass.`,
      input: {},
      async run() {
        let output = "";
        const result = await runGates({
          cwd: spec.cwd,
          level,
          base: spec.base,
          log: (text) => {
            output += text;
          },
        });
        gatesPassed = result.status === "pass";
        const line = gatesLine(result);
        return gatesPassed ? line : `${outputTail(output)}\n${line}`;
      },
    });
  }

  const policy = {
    worktree: spec.cwd,
    scope: spec.policy.writable ? spec.policy.scope : [],
    protectedPaths: spec.policy.protectedPaths,
    existingTests: new Set(spec.policy.existingTests),
  };
  const sandbox: SandboxPaths = spec.sandbox;

  return await agent.run({
    agent: spec.agent,
    model: spec.model,
    cwd: spec.cwd,
    instructions: spec.instructions,
    prompt: spec.prompt,
    outputSchema: spec.outputSchema,
    maxTurns: spec.maxTurns,
    maxCostUsd: spec.maxCostUsd,
    signal,
    env: factoryGitEnvironment,
    sandbox,
    tools,
    record: (record) => emit({ record }),
    guard: (tool, input) => guardToolCall(tool, input, policy),
    async pendingInstructions() {
      const instructions = await queued(spec.queue, delivered);
      const last = instructions.at(-1);
      if (last) delivered = last.seq;
      return instructions;
    },
    async beforeStop() {
      if (blocked) return null;
      if (level !== null && !gatesPassed) {
        return `Run the gates tool and make the ${level} gates pass before you finish, or call kozo_blocked if you cannot.`;
      }
      if (spec.requireNote && notes === 0) {
        return "Record your main decisions with kozo_note before you finish.";
      }
      return null;
    },
  });
}
