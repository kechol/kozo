import { mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { sha256 } from "@kozo/core";
import type { AgentRequest, CodingAgent } from "@kozo/worker";
import { testGitEnvironment } from "./git-repository.ts";

/** One step of a fake agent's script. */
export type FakeStep =
  | { say: string }
  /** A built-in tool call, put to the request's guard first; its output is scripted. */
  | { tool: string; input: unknown; output: unknown; error?: boolean }
  /** A call of one of the request's in-process tools, which really runs. */
  | { use: string; input?: Record<string, unknown> }
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
 * session ends at the first answer or failure, or as stopped once kozod aborts it. Built-in
 * tool calls go through the request's guard and an answer through its stop-check, as with a
 * real session: an objection sends the script on to its next step, and fails the session when
 * no step is left.
 */
export function fakeAgent(script: FakeScript): FakeAgent {
  const requests: AgentRequest[] = [];
  return {
    requests,
    async run(request) {
      requests.push(request);
      const steps = typeof script === "function" ? script(request) : script;
      request.record({
        type: "session.started",
        data: {
          claude_version: "fake",
          model: request.model,
          brief_sha: sha256(request.prompt),
          instructions_sha: sha256(request.instructions),
        },
      });
      let costUsd = 0;
      let turns = 0;
      let calls = 0;
      for (const [index, step] of steps.entries()) {
        if (request.signal.aborted) return { status: "stopped", costUsd, turns };
        turns += 1;
        if ("say" in step) {
          request.record({ type: "agent.message", data: { agent: request.agent, text: step.say } });
        } else if ("tool" in step) {
          calls += 1;
          const call_id = `fake-${calls}`;
          const decision = await request.guard(step.tool, step.input);
          request.record({
            type: "tool.call",
            data: { call_id, tool: step.tool, input: step.input },
          });
          request.record(
            decision.allow
              ? {
                  type: "tool.result",
                  data: { call_id, is_error: step.error ?? false, output: step.output },
                }
              : {
                  type: "guard.denied",
                  data: { call_id, tool: step.tool, reason: decision.reason },
                },
          );
        } else if ("use" in step) {
          calls += 1;
          const call_id = `fake-${calls}`;
          const tool = request.tools?.find((candidate) => candidate.name === step.use);
          const input = step.input ?? {};
          request.record({
            type: "tool.call",
            data: { call_id, tool: `mcp__kozo__${step.use}`, input },
          });
          const output = tool ? await tool.run(input) : `no tool ${step.use}`;
          request.record({
            type: "tool.result",
            data: { call_id, is_error: tool === undefined, output },
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
          const objection = (await request.beforeStop?.()) ?? null;
          if (objection !== null && index < steps.length - 1) continue;
          if (objection !== null) {
            return { status: "failed", reason: `stop-check: ${objection}`, costUsd, turns };
          }
          return { status: "answered", output: step.answer, costUsd, turns };
        } else {
          return { status: "failed", reason: step.fail, costUsd, turns };
        }
      }
      return { status: "failed", reason: "the script ended without an answer", costUsd, turns };
    },
  };
}
