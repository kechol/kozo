import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { sha256 } from "@kozo/core";
import { eventually, fakeAgent, gitRepository } from "@kozo/testing";
import { z } from "zod";
import { claudeAgent } from "./claude-agent.ts";
import { claudeCliAgent } from "./claude-cli-agent.ts";
import type { AgentRecord, AgentRequest, CodingAgent, Instruction } from "./coding-agent.ts";
import { factoryGitEnvironment } from "./git-environment.ts";
import { guardToolCall } from "./guard.ts";

type Scenario = "answer" | "instruction" | "stop" | "objection";

const answerSchema = {
  type: "object",
  properties: { word: { type: "string" } },
  required: ["word"],
  additionalProperties: false,
};

const prompts: Record<Scenario, string> = {
  answer:
    'Create the file hello.txt containing the single line "hi", commit it with git (message "add hello"), and answer with the word "done".',
  instruction:
    'Run `sleep 1` with Bash once. Then answer with the single word that an instruction from the owner gives you, or "none" if no instruction arrived.',
  stop: "Run `sleep 60` with Bash, then answer with the word done.",
  objection: 'Answer with the word "cherry".',
};

const scripts: Record<Scenario, Parameters<typeof fakeAgent>[0]> = {
  answer: [
    { write: { "hello.txt": "hi\n" } },
    { commit: "add hello" },
    { tool: "Bash", input: { command: "git commit" }, output: "" },
    { answer: { word: "done" } },
  ],
  instruction: [
    { tool: "Bash", input: { command: "sleep 1" }, output: "" },
    { awaitInstruction: true },
    { answer: { word: "pineapple" } },
  ],
  stop: [{ tool: "Bash", input: { command: "sleep 60" }, output: "" }, { hang: true }],
  objection: [
    { answer: { word: "cherry" } },
    { use: "kozo_word", input: { color: "blue" } },
    { answer: { word: "ocean" } },
  ],
};

interface Implementation {
  name: string;
  agent(scenario: Scenario): CodingAgent;
  model: string;
}

const implementations: Implementation[] = [
  { name: "fake agent", agent: (scenario) => fakeAgent(scripts[scenario]), model: "fake" },
];
const claude = Bun.which("claude");
if (process.env.KOZO_LIVE === "1" && claude) {
  implementations.push({
    name: "Agent SDK adapter",
    agent: () => claudeAgent(claude),
    model: "claude-haiku-5-5",
  });
  // kozod's own entry point, which serves the hooks and the tools of a CLI session.
  const kozod = [process.execPath, join(import.meta.dir, "../../daemon/src/main.ts")];
  implementations.push({
    name: "CLI adapter",
    agent: () => claudeCliAgent(claude, kozod),
    model: "claude-haiku-5-5",
  });
}

function request(cwd: string, scenario: Scenario, model: string, queue: Instruction[] = []) {
  const records: AgentRecord[] = [];
  const controller = new AbortController();
  const value: AgentRequest = {
    agent: "implement",
    model,
    cwd,
    instructions:
      "You are a careful agent working in a git repository. Follow the request exactly.",
    prompt: prompts[scenario],
    outputSchema: answerSchema,
    maxTurns: 12,
    maxCostUsd: 0.5,
    pendingInstructions: async () => queue.splice(0),
    record: (record) => records.push(record),
    signal: controller.signal,
    env: factoryGitEnvironment,
    guard: (tool, input) =>
      guardToolCall(tool, input, {
        worktree: cwd,
        scope: ["**"],
        protectedPaths: [],
        existingTests: new Set(),
      }),
  };
  return { value, records, controller };
}

for (const implementation of implementations) {
  describe(`CodingAgent contract: ${implementation.name}`, () => {
    test("edits and commits in the worktree, records its work and answers", async () => {
      await using repo = await gitRepository();
      await repo.commit({ "README.md": "# test\n" }, "start");
      const { value, records } = request(repo.path, "answer", implementation.model);
      const outcome = await implementation.agent("answer").run(value);
      expect(outcome).toMatchObject({ status: "answered", output: { word: "done" } });
      expect(await Bun.file(`${repo.path}/hello.txt`).text()).toBe("hi\n");
      expect(await repo.git("log", "-1", "--format=%s")).toBe("add hello");
      expect(records.some((record) => record.type === "tool.call")).toBe(true);
      expect(records[0]).toMatchObject({
        type: "session.started",
        data: { brief_sha: sha256(value.prompt) },
      });
    }, 180_000);

    test("delivers a queued instruction at a turn boundary", async () => {
      await using repo = await gitRepository();
      const queue = [{ seq: 0, text: "The word is pineapple." }];
      const { value, records } = request(repo.path, "instruction", implementation.model, queue);
      const outcome = await implementation.agent("instruction").run(value);
      expect(records).toContainEqual({
        type: "instruction.delivered",
        data: { queue_seq: 0, text: "The word is pineapple." },
      });
      expect(outcome).toMatchObject({ status: "answered", output: { word: "pineapple" } });
    }, 180_000);

    test("sends the agent back when the stop-check objects to its answer", async () => {
      await using repo = await gitRepository();
      const { value } = request(repo.path, "objection", implementation.model);
      const calls: unknown[] = [];
      value.tools = [
        {
          name: "kozo_word",
          description: "Returns the word for a color.",
          input: { color: z.string() },
          run: async (input) => {
            calls.push(input);
            return "ocean";
          },
        },
      ];
      value.beforeStop = async () =>
        calls.length === 0 ? "Call kozo_word with the color blue before you finish." : null;
      const outcome = await implementation.agent("objection").run(value);
      expect(outcome).toMatchObject({ status: "answered" });
      expect(calls).toContainEqual({ color: "blue" });
    }, 180_000);

    test("stops when the signal aborts", async () => {
      await using repo = await gitRepository();
      const { value, records, controller } = request(repo.path, "stop", implementation.model);
      const outcome = implementation.agent("stop").run(value);
      await eventually(
        () => records.some((record) => record.type === "tool.call"),
        "the first tool call",
      );
      controller.abort();
      expect(await outcome).toMatchObject({ status: "stopped" });
    }, 180_000);
  });
}
