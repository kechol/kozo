import { describe, expect, test } from "bun:test";
import type { HookInput } from "@anthropic-ai/claude-agent-sdk";
import { sessionHooks } from "./claude-session.ts";
import type { AgentRecord, AgentRequest, Instruction } from "./coding-agent.ts";

const answer = {
  hook_event_name: "PreToolUse",
  tool_name: "StructuredOutput",
  tool_input: { word: "cherry" },
  tool_use_id: "t1",
} as HookInput;

function request(objections: (string | null)[], queue: Instruction[] = []) {
  const records: AgentRecord[] = [];
  const value: AgentRequest = {
    agent: "implement",
    model: "claude-sonnet-5-5",
    cwd: "/tmp/worktree",
    instructions: "Implement.",
    prompt: "GOAL x",
    outputSchema: {},
    maxTurns: 3,
    maxCostUsd: 1,
    pendingInstructions: async () => queue.splice(0),
    record: (record) => records.push(record),
    signal: new AbortController().signal,
    guard: async () => ({ allow: true }),
    beforeStop: async () => objections.shift() ?? null,
  };
  return { value, records };
}

describe("sessionHooks", () => {
  test("refuses the structured answer while the stop-check objects", async () => {
    const { value } = request(["Call kozo_gates first."]);
    const hooks = sessionHooks(value);
    expect(await hooks.preToolUse(answer)).toEqual({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: "Call kozo_gates first.",
      },
    });
    expect(await hooks.preToolUse(answer)).toEqual({});
  });

  test("an instruction that arrives with the answer sends the agent back with it", async () => {
    const { value, records } = request([], [{ seq: 0, text: "Say ocean." }]);
    const decision = await sessionHooks(value).preToolUse(answer);
    expect(decision).toMatchObject({
      hookSpecificOutput: { permissionDecisionReason: expect.stringContaining("Say ocean.") },
    });
    expect(records).toEqual([
      { type: "instruction.delivered", data: { queue_seq: 0, text: "Say ocean." } },
    ]);
  });

  test("other tool calls the guard allows are not checked", async () => {
    let checks = 0;
    const { value } = request([]);
    value.beforeStop = async () => {
      checks += 1;
      return "not yet";
    };
    const bash = { ...answer, tool_name: "Bash", tool_input: { command: "ls" } } as HookInput;
    expect(await sessionHooks(value).preToolUse(bash)).toEqual({});
    expect(checks).toBe(0);
  });
});
