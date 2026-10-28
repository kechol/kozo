import { agentNameSchema, blockedReasonSchema, type GateLevel, gateLevelSchema } from "@kozo/core";
import { type Confine, gatesLine, git, runGates } from "@kozo/verify";
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
  version: z.literal(5),
  run: z.string(),
  /** How the worker runs Claude Code: through the Agent SDK, or as `claude -p`. */
  runtime: z.enum(["sdk", "cli"]),
  agent: agentNameSchema,
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
    /** The constraints' test globs, under which new test files may go outside the scope. */
    tests: z.array(z.string()),
    /** Every file at the base, to tell a new test case from an existing file. */
    baseFiles: z.array(z.string()),
    /** False for an agent that only reads, which may write nowhere. */
    writable: z.boolean(),
  }),
  sandbox: z.strictObject({
    denyRead: z.array(z.string()),
    allowRead: z.array(z.string()),
    allowWrite: z.array(z.string()),
    denyWrite: z.array(z.string()),
  }),
  /**
   * The gates the agent runs with kozo_gates and stop-check requires: the level that must pass,
   * the ref whose constraints define them, and the environment, command sandbox and time limit
   * per gate kozod's own gates run them with; null gives the agent no gates.
   */
  gates: z
    .strictObject({
      level: gateLevelSchema,
      base: z.string(),
      env: z.record(z.string(), z.string()),
      sandbox: z.strictObject({
        denyRead: z.array(z.string()),
        allowRead: z.array(z.string()),
        denyReadInside: z.array(z.string()),
        allowWrite: z.array(z.string()),
        denyWrite: z.array(z.string()),
        network: z.enum(["local", "any"]),
        denyPorts: z.array(z.int().positive()),
      }),
      minutes: z.number().positive(),
    })
    .nullable(),
  /** Whether stop-check requires at least one kozo_note. */
  requireNote: z.boolean(),
});
export type WorkerSpec = z.infer<typeof workerSpecSchema>;

/** One line a worker writes to kozod on stdout. */
export type WorkerMessage = { record: AgentRecord } | { note: string } | { outcome: AgentOutcome };

/** One line of a run's instruction queue as kozod writes it. */
export const queueLineSchema = z.strictObject({
  v: z.literal(1),
  ts: z.iso.datetime(),
  text: z.string(),
});

/** The queue's entries after `delivered`, read again at every turn boundary. */
async function queued(path: string, delivered: number): Promise<Instruction[]> {
  const file = Bun.file(path);
  if (!(await file.exists())) return [];
  return (await file.text())
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line, seq) => ({ seq, text: queueLineSchema.parse(JSON.parse(line)).text }))
    .filter((instruction) => instruction.seq > delivered);
}

const gateRank = (level: GateLevel) => gateLevelSchema.options.indexOf(level);

/** The commit the worktree is at, or null while it has changes that are not committed. */
async function committedHead(cwd: string): Promise<string | null> {
  if ((await git(cwd, ["status", "--porcelain"])).trim() !== "") return null;
  return (await git(cwd, ["rev-parse", "HEAD"])).trim();
}

/**
 * Runs one session for a run: the guard and sandbox of its task, the agent tools, delivery of
 * queued instructions and stop-check. Every record, note and block goes to `emit`. The agent
 * runs its gates with kozo_gates, which runs them here in the command sandbox that `confine`
 * applies, the one kozod's own gates run in, rather than in the agent's shell, whose sandbox
 * cannot run a browser.
 */
export async function runSession(
  spec: WorkerSpec,
  agent: CodingAgent,
  emit: (message: WorkerMessage) => void,
  signal: AbortSignal,
  confine: Confine,
): Promise<AgentOutcome> {
  let delivered = -1;
  let notes = 0;
  let blocked = false;
  /** The level and commit of the last kozo_gates call, when it passed on a committed worktree. */
  let passedAt: { level: GateLevel; head: string } | null = null;

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
      async run() {
        blocked = true;
        return "Recorded. Finish now with a run report whose outcome is blocked, with this reason and question.";
      },
    },
  ];
  const gates = spec.gates;
  if (gates !== null) {
    tools.push({
      name: "kozo_gates",
      description: `Run the repository's gates at a level on the worktree as it is, in the factory's sandbox, and get the end of their output and the KOZO_GATES line. The ${gates.level} gates must pass on your last commit, with nothing left uncommitted, before you finish.`,
      input: { level: gateLevelSchema },
      async run(input) {
        const level = gateLevelSchema.parse(input.level);
        const head = await committedHead(spec.cwd);
        let output = "";
        const result = await runGates({
          cwd: spec.cwd,
          level,
          base: gates.base,
          env: gates.env,
          confined: { confine, sandbox: gates.sandbox },
          limit: { minutes: gates.minutes },
          log: (text) => {
            output += text;
          },
        });
        passedAt = result.status === "pass" && head !== null ? { level, head } : null;
        const note =
          result.status === "pass" && head === null
            ? "\nThe worktree had uncommitted changes, so this pass does not count; commit and run kozo_gates again."
            : "";
        return `${output.slice(-8000)}${gatesLine(result)}${note}`;
      },
    });
  }
  const policy = {
    worktree: spec.cwd,
    scope: spec.policy.writable ? spec.policy.scope : [],
    protectedPaths: spec.policy.protectedPaths,
    existingTests: new Set(spec.policy.existingTests),
    tests: spec.policy.writable ? spec.policy.tests : undefined,
    baseFiles: new Set(spec.policy.baseFiles),
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
      if (gates !== null) {
        const passed = passedAt;
        const current = await committedHead(spec.cwd);
        if (
          passed === null ||
          gateRank(passed.level) < gateRank(gates.level) ||
          passed.head !== current
        ) {
          return `Commit your change, then call kozo_gates with level ${gates.level} and make it pass before you finish, or call kozo_blocked if you cannot.`;
        }
      }
      if (spec.requireNote && notes === 0) {
        return "Record your main decisions with kozo_note before you finish.";
      }
      return null;
    },
  });
}
