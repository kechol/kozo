import { describe, expect, test } from "bun:test";
import type { AgentRecord, AgentRequest, Instruction } from "@kozo/worker";
import { fakeAgent } from "./fake-agent.ts";
import { gitRepository } from "./git-repository.ts";

function request(cwd: string, overrides: Partial<AgentRequest> = {}) {
  const records: AgentRecord[] = [];
  const controller = new AbortController();
  const queue: Instruction[] = [];
  const value: AgentRequest = {
    agent: "implement",
    model: "fake",
    cwd,
    instructions: "Implement the brief.",
    prompt: "GOAL Fix it",
    outputSchema: {},
    maxTurns: 10,
    maxCostUsd: 1,
    pendingInstructions: async () => queue.splice(0),
    record: (record) => records.push(record),
    signal: controller.signal,
    guard: async () => ({ allow: true }),
    ...overrides,
  };
  return { value, records, controller, queue };
}

describe("fakeAgent", () => {
  test("edits and commits in its worktree, records and answers as scripted", async () => {
    await using repo = await gitRepository();
    await repo.commit({ "README.md": "# shop\n" }, "start");
    const agent = fakeAgent([
      { say: "Writing the fix." },
      { write: { "src/cart.ts": "export const blank = false;\n" } },
      { commit: "fix: reject a blank quantity" },
      { tool: "gates", input: { level: "fast" }, output: "status=pass" },
      { spend: 0.25 },
      { answer: { outcome: "done" } },
    ]);
    const { value, records } = request(repo.path);
    expect(await agent.run(value)).toEqual({
      status: "answered",
      output: { outcome: "done" },
      costUsd: 0.25,
      turns: 6,
    });
    expect(await repo.git("log", "--format=%s", "-1")).toBe("fix: reject a blank quantity");
    expect(records.map((record) => record.type)).toEqual([
      "agent.message",
      "tool.call",
      "tool.result",
      "cost.tick",
    ]);
    expect(agent.requests).toHaveLength(1);
  });

  test("delivers a queued instruction and stops when asked", async () => {
    await using repo = await gitRepository();
    const agent = fakeAgent([{ awaitInstruction: true }, { hang: true }]);
    const { value, records, controller, queue } = request(repo.path);
    const outcome = agent.run(value);
    queue.push({ seq: 0, text: "Keep the old label for zero." });
    await Bun.sleep(50);
    controller.abort();
    expect(await outcome).toMatchObject({ status: "stopped" });
    expect(records).toEqual([
      {
        type: "instruction.delivered",
        data: { queue_seq: 0, text: "Keep the old label for zero." },
      },
    ]);
  });

  test("a script without an answer fails", async () => {
    await using repo = await gitRepository();
    const { value } = request(repo.path);
    expect(await fakeAgent([{ say: "hm" }]).run(value)).toMatchObject({ status: "failed" });
    expect(await fakeAgent([{ fail: "no tests" }]).run(value)).toMatchObject({
      status: "failed",
      reason: "no tests",
    });
  });
});
