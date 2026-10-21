import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { type FakeStep, fakeAgent, gitRepository, suiteBase } from "@kozo/testing";
import { runSession, type WorkerMessage, type WorkerSpec } from "./session.ts";
import { workerMain } from "./worker-main.ts";

async function suite() {
  const repo = await gitRepository();
  await repo.commit(suiteBase, "the suite shop");
  await repo.git("switch", "--quiet", "-c", "kozo/K-1-t1");
  const spec: WorkerSpec = {
    version: 1,
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
      writable: true,
    },
    sandbox: { denyRead: [], allowRead: [], allowWrite: [], denyWrite: [] },
    gates: "fast",
    base: "main",
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
  test("the gates tool reports the gates of the base, and stop-check lets a passing run finish", async () => {
    const { repo, spec } = await suite();
    await using _ = repo;
    const { outcome, messages } = await play(spec, [
      { use: "gates" },
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
    expect(String(results(messages)[0])).toStartWith("KOZO_GATES: level=fast status=pass");
    expect(messages).toContainEqual({
      note: "Kept the label function — It is the one place labels come from",
    });
  }, 60_000);

  test("stop-check sends the agent back while the gates fail or nothing is noted", async () => {
    const { repo, spec } = await suite();
    await using _ = repo;
    const failing = await play(spec, [
      { write: { "src/debug.ts": "console.log('x');\n" } },
      { use: "gates" },
      { answer: {} },
    ]);
    expect(String(results(failing.messages)[0])).toContain("status=fail");
    expect(failing.outcome).toMatchObject({
      status: "failed",
      reason: expect.stringContaining("make the fast gates pass"),
    });
    const unnoted = await play(spec, [
      { write: { "src/debug.ts": null } },
      { use: "gates" },
      { answer: {} },
    ]);
    expect(unnoted.outcome).toMatchObject({ reason: expect.stringContaining("kozo_note") });
    const blocked = await play(spec, [
      {
        use: "kozo_blocked",
        input: { reason: "ambiguous", question: "Is zero Sold out or Only 0 left?" },
      },
      { answer: { outcome: "blocked" } },
    ]);
    expect(blocked.outcome).toMatchObject({ status: "answered" });
    expect(blocked.messages).toContainEqual({
      blocked: { reason: "ambiguous", question: "Is zero Sold out or Only 0 left?" },
    });
  }, 60_000);

  test("the guard refuses what the task may not do", async () => {
    const { repo, spec } = await suite();
    await using _ = repo;
    const { messages } = await play(spec, [
      { tool: "Bash", input: { command: "git push origin HEAD:main" }, output: "" },
      { tool: "Edit", input: { file_path: "src/stock.test.ts" }, output: "" },
      { tool: "Write", input: { file_path: ".kozo/charter.yml" }, output: "" },
      { tool: "Read", input: { file_path: "/etc/hosts" }, output: "" },
      { fail: "done" },
    ]);
    expect(results(messages).map((output) => String(output).split(":")[0])).toEqual([
      "refused",
      "refused",
      "refused",
      "refused",
    ]);
  });

  test("queued instructions are delivered once each", async () => {
    const { repo, spec } = await suite();
    await using _ = repo;
    await Bun.write(spec.queue, `${JSON.stringify({ text: "Keep zero as Sold out." })}\n`);
    const pending = play({ ...spec, gates: null, requireNote: false }, [
      { awaitInstruction: true },
      { awaitInstruction: true },
      { answer: {} },
    ]);
    await Bun.sleep(100);
    await Bun.write(
      spec.queue,
      `${JSON.stringify({ text: "Keep zero as Sold out." })}\n${JSON.stringify({ text: "And 1 says Only 1 left." })}\n`,
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
      fakeAgent([{ say: "hello" }, { answer: { ok: true } }]),
    );
    expect(lines.map((line) => Object.keys(JSON.parse(line))[0])).toEqual(["record", "outcome"]);
    expect(JSON.parse(lines[1] ?? "{}").outcome).toMatchObject({
      status: "answered",
      output: { ok: true },
    });
  });
});
