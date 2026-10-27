import { describe, expect, test } from "bun:test";
import type { HookInput, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { sessionHooks, sessionReader } from "./claude-session.ts";
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

describe("sessionReader", () => {
  const result = (subtype: string, extra: object = {}) =>
    ({
      type: "result",
      subtype,
      num_turns: 2,
      total_cost_usd: 0.1,
      usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0 },
      result: "I am done.",
      ...extra,
    }) as unknown as SDKMessage;

  test("tells a limit, a missing answer and an API failure apart", () => {
    const kind = (message: SDKMessage) => {
      const outcome = sessionReader(request([]).value).read(message);
      return outcome?.status === "failed" ? outcome.kind : outcome?.status;
    };
    expect(kind(result("error_max_turns"))).toBe("limit");
    expect(kind(result("error_max_budget_usd"))).toBe("limit");
    expect(kind(result("error_during_execution"))).toBe("api");
    expect(kind(result("success"))).toBe("no-answer");
    expect(kind(result("success", { structured_output: { word: "x" } }))).toBe("answered");
  });
});
