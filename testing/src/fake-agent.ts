import { mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { AgentRequest, CodingAgent } from "@kozo/worker";
import { testGitEnvironment } from "./git-repository.ts";

/** One step of a fake agent's script. */
export type FakeStep =
  | { say: string }
  | { tool: string; input: unknown; output: unknown; error?: boolean }
  /** Writes files in the worktree; null deletes one. */
  | { write: Record<string, string | null> }
  /** Commits everything in the worktree. */
  | { commit: string }
  /** Adds to the session's cost. */
  | { spend: number }
  /** Waits for a queued instruction and records its delivery. */
  | { awaitInstruction: true }
  /** Waits until kozod stops the run. */
  | { hang: true }
  | { answer: unknown }
  | { fail: string };

export type FakeScript = FakeStep[] | ((request: AgentRequest) => FakeStep[]);

export interface FakeAgent extends CodingAgent {
  /** Every request the agent received, in order. */
  requests: AgentRequest[];
}

async function git(cwd: string, ...args: string[]) {
  const child = Bun.spawn(["git", ...args], {
    cwd,
    env: testGitEnvironment,
    stdout: "ignore",
    stderr: "pipe",
  });
  const [stderr, code] = await Promise.all([new Response(child.stderr).text(), child.exited]);
  if (code !== 0) throw new Error(`git ${args.join(" ")} failed: ${stderr}`);
}

const stopped = (signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal.aborted) resolve();
    else signal.addEventListener("abort", () => resolve(), { once: true });
  });

/**
 * A CodingAgent that plays a script instead of calling a model. Each step is one turn; the
 * session ends at the first answer or failure, or as stopped once kozod aborts it.
 */
export function fakeAgent(script: FakeScript): FakeAgent {
  const requests: AgentRequest[] = [];
  return {
    requests,
    async run(request) {
      requests.push(request);
      const steps = typeof script === "function" ? script(request) : script;
      let costUsd = 0;
      let turns = 0;
      let calls = 0;
      for (const step of steps) {
        if (request.signal.aborted) return { status: "stopped", costUsd, turns };
        turns += 1;
        if ("say" in step) {
          request.record({ type: "agent.message", data: { agent: request.agent, text: step.say } });
        } else if ("tool" in step) {
          calls += 1;
          const call_id = `fake-${calls}`;
          request.record({
            type: "tool.call",
            data: { call_id, tool: step.tool, input: step.input },
          });
          request.record({
            type: "tool.result",
            data: { call_id, is_error: step.error ?? false, output: step.output },
          });
        } else if ("write" in step) {
          for (const [name, content] of Object.entries(step.write)) {
            const path = join(request.cwd, name);
            if (content === null) {
              await rm(path, { force: true });
            } else {
              await mkdir(dirname(path), { recursive: true });
              await Bun.write(path, content);
            }
          }
        } else if ("commit" in step) {
          await git(request.cwd, "add", "--all");
          await git(request.cwd, "commit", "--quiet", "--message", step.commit);
        } else if ("spend" in step) {
          costUsd += step.spend;
          request.record({
            type: "cost.tick",
            data: { usd: costUsd, in: 0, out: 0, cache_read: 0 },
          });
        } else if ("awaitInstruction" in step) {
          for (;;) {
            const [instruction] = await request.pendingInstructions();
            if (instruction) {
              request.record({
                type: "instruction.delivered",
                data: { queue_seq: instruction.seq, text: instruction.text },
              });
              break;
            }
            if (request.signal.aborted) return { status: "stopped", costUsd, turns };
            await Bun.sleep(10);
          }
        } else if ("hang" in step) {
          await stopped(request.signal);
          return { status: "stopped", costUsd, turns };
        } else if ("answer" in step) {
          return { status: "answered", output: step.answer, costUsd, turns };
        } else {
          return { status: "failed", reason: step.fail, costUsd, turns };
        }
      }
      return { status: "failed", reason: "the script ended without an answer", costUsd, turns };
    },
  };
}
