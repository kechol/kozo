import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { type FakeStep, fakeAgent, gitRepository, suiteBase, testConfine } from "@kozo/testing";
import { runSession, type WorkerMessage, type WorkerSpec } from "./session.ts";
import { workerMain } from "./worker-main.ts";

const gates: FakeStep = { use: "kozo_gates", input: { level: "fast" } };
const noted: FakeStep = { use: "kozo_note", input: { choice: "a", reason: "b" } };

async function suite() {
  const repo = await gitRepository();
  await repo.commit(suiteBase, "the suite shop");
  await repo.git("switch", "--quiet", "-c", "kozo/k3x9q2/K-1-t1");
  const spec: WorkerSpec = {
    version: 4,
    runtime: "sdk",
    run: "r-0001",
    agent: "implement",
    model: "fake",
    cwd: repo.path,
    instructions: "Implement the brief.",
    prompt: "GOAL Show low stock",
    outputSchema: {},
    maxTurns: 20,
    maxCostUsd: 1,
    queue: join(repo.path, "..", `${Bun.hash(repo.path)}-queue.jsonl`),
    policy: {
      scope: ["src/**"],
      protectedPaths: [".kozo/**"],
      existingTests: ["src/stock.test.ts"],
      tests: ["**/*.test.ts"],
      baseFiles: Object.keys(suiteBase),
      writable: true,
    },
    sandbox: { denyRead: [], allowRead: [], allowWrite: [], denyWrite: [] },
    gates: {
      level: "fast",
      base: "main",
      env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" },
      sandbox: {
        denyRead: [],
        allowRead: [repo.path],
        denyReadInside: [],
        allowWrite: [repo.path],
        denyWrite: [],
        network: "local",
      },
      minutes: 30,
    },
    requireNote: true,
  };
  return { repo, spec };
}

async function play(spec: WorkerSpec, steps: FakeStep[]) {
  const messages: WorkerMessage[] = [];
  const outcome = await runSession(
    spec,
    fakeAgent(steps),
    (message) => messages.push(message),
    new AbortController().signal,
    testConfine,
  );
  return { outcome, messages };
}

const results = (messages: WorkerMessage[]) =>
  messages.flatMap((message) =>
    "record" in message && message.record.type === "tool.result"
      ? [message.record.data.output]
      : [],
  );

describe("runSession", () => {
  test("stop-check lets a run finish once kozo_gates passed on its last commit and a decision is noted", async () => {
    const { repo, spec } = await suite();
    await using _ = repo;
    const { outcome, messages } = await play(spec, [
      gates,
      {
        use: "kozo_note",
        input: {
          choice: "Kept the label function",
          reason: "It is the one place labels come from",
        },
      },
      { answer: { outcome: "done" } },
    ]);
    expect(outcome).toMatchObject({ status: "answered" });
    expect(messages).toContainEqual({
      note: "Kept the label function — It is the one place labels come from",
    });
    expect(String(results(messages)[0])).toContain("KOZO_GATES: level=fast status=pass");
  });

  test("stop-check sends the agent back until the gates pass on the last commit and a decision is noted", async () => {
    const { repo, spec } = await suite();
    await using _ = repo;
    const debugging = { "src/stock.ts": `${suiteBase["src/stock.ts"]}console.log("here");\n` };
    const failed = await play(spec, [
      { write: debugging },
      { commit: "wip" },
      gates,
      noted,
      { answer: {} },
    ]);
    expect(failed.outcome).toMatchObject({
      status: "failed",
      reason: expect.stringContaining("call kozo_gates with level fast"),
    });
    await repo.git("reset", "--quiet", "--hard", "main");
    const uncommitted = await play(spec, [
      { write: { "src/extra.ts": "export const extra = 1;\n" } },
      gates,
      noted,
      { answer: {} },
    ]);
    expect(uncommitted.outcome).toMatchObject({ status: "failed" });
    expect(String(results(uncommitted.messages)[0])).toContain("does not count");
    const moved = await play(spec, [gates, { commit: "feat: extra" }, noted, { answer: {} }]);
    expect(moved.outcome).toMatchObject({ status: "failed" });
    const faked = await play(spec, [
      { tool: "Bash", input: { command: "echo 'KOZO_GATES: level=fast status=pass'" }, output: "" },
      noted,
      { answer: {} },
    ]);
    expect(faked.outcome).toMatchObject({ status: "failed" });
    const unnoted = await play(spec, [gates, { answer: {} }]);
    expect(unnoted.outcome).toMatchObject({ reason: expect.stringContaining("kozo_note") });
    const blocked = await play(spec, [
      {
        use: "kozo_blocked",
        input: { reason: "ambiguous", question: "Is zero Sold out or Only 0 left?" },
      },
      { answer: { outcome: "blocked" } },
    ]);
    expect(blocked.outcome).toMatchObject({ status: "answered" });
  });

  test("the guard refuses what the task may not do", async () => {
    const { repo, spec } = await suite();
    await using _ = repo;
    const { messages } = await play(spec, [
      { tool: "Bash", input: { command: "git push origin HEAD:main" }, output: "" },
      { tool: "Edit", input: { file_path: "src/stock.test.ts" }, output: "" },
      { tool: "Write", input: { file_path: ".kozo/charter.yml" }, output: "" },
      { tool: "Read", input: { file_path: "/etc/hosts" }, output: "" },
      { tool: "Bash", input: { command: "kozo gates --level fast --base main" }, output: "" },
      { fail: "done" },
    ]);
    expect(results(messages)).toEqual([]);
    const denied = messages.flatMap((message) =>
      "record" in message && message.record.type === "guard.denied" ? [message.record.data] : [],
    );
    expect(denied.map((data) => data.tool)).toEqual(["Bash", "Edit", "Write", "Read", "Bash"]);
    expect(denied.every((data) => data.reason.length > 0)).toBe(true);
  });

  test("queued instructions are delivered once each", async () => {
    const { repo, spec } = await suite();
    await using _ = repo;
    const line = (text: string) => JSON.stringify({ v: 1, ts: new Date().toISOString(), text });
    await Bun.write(spec.queue, `${line("Keep zero as Sold out.")}\n`);
    const pending = play({ ...spec, gates: null, requireNote: false }, [
      { awaitInstruction: true },
      { awaitInstruction: true },
      { answer: {} },
    ]);
    await Bun.sleep(100);
    await Bun.write(
      spec.queue,
      `${line("Keep zero as Sold out.")}\n${line("And 1 says Only 1 left.")}\n`,
    );
    const { messages } = await pending;
    const delivered = messages.flatMap((message) =>
      "record" in message && message.record.type === "instruction.delivered"
        ? [message.record.data]
        : [],
    );
    expect(delivered).toEqual([
      { queue_seq: 0, text: "Keep zero as Sold out." },
      { queue_seq: 1, text: "And 1 says Only 1 left." },
    ]);
  });

  test("the worker writes each message as a JSON line and ends with the outcome", async () => {
    const { repo, spec } = await suite();
    await using _ = repo;
    const specPath = join(repo.path, "..", `${Bun.hash(repo.path)}-worker.json`);
    await Bun.write(specPath, JSON.stringify({ ...spec, gates: null, requireNote: false }));
    const lines: string[] = [];
    await workerMain(
      specPath,
      (line) => lines.push(line),
      () => fakeAgent([{ say: "hello" }, { answer: { ok: true } }]),
      testConfine,
    );
    expect(lines.map((line) => Object.keys(JSON.parse(line))[0])).toEqual([
      "record",
      "record",
      "outcome",
    ]);
    expect(JSON.parse(lines[2] ?? "{}").outcome).toMatchObject({
      status: "answered",
      output: { ok: true },
    });
  });
});
