import { describe, expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { kozoHome, runFiles } from "@kozo/core";
import {
  type FakeStep,
  fakeAgent,
  gitRepository,
  goodChange,
  suiteBase,
  suiteTask,
  tempDirectory,
} from "@kozo/testing";
import type { Judge, Verifier } from "@kozo/verify";
import type { AgentRequest } from "@kozo/worker";
import { ControlPlane } from "./control-plane.ts";
import { EventStore } from "./event-store.ts";
import { loadFactory } from "./factory-config.ts";
import { inProcessLauncher } from "./launcher.ts";
import { Runner } from "./runner.ts";
import { Scheduler } from "./scheduler.ts";

const plan = {
  outcome: "plan",
  plan: {
    class: "bugfix",
    risk: "normal",
    approach: "Add the low-stock wording to stockLabel and test it",
    done_when: suiteTask.doneWhen,
    tasks: [
      {
        id: "t1",
        goal: suiteTask.goal,
        done_when: suiteTask.doneWhen,
        scope: suiteTask.scope,
        depends_on: [],
        estimate: { lines: 20, files: 2 },
      },
    ],
  },
};

const report = {
  version: 1,
  outcome: "done",
  summary: "stockLabel says Only N left for 1 to 3 units.",
  changes: ["Added the low-stock branch to stockLabel"],
  out_of_scope: [],
  tests: ["src/stock-low.test.ts"],
};

const judgeWith = (verdict: "accept" | "revise" | "escalate"): Judge => ({
  async judge(request) {
    return {
      output: { verdict, summary: `${verdict}: the label`, findings: [] },
      model: request.model,
      costUsd: 0.01,
    };
  },
});

const noVerifier: Verifier = {
  async verify() {
    throw new Error("verify-app is missing, so verify never runs");
  },
};

async function factoryOf(
  script: (request: AgentRequest) => FakeStep[],
  judge: Judge = judgeWith("accept"),
) {
  const repo = await gitRepository();
  await repo.commit(suiteBase, "the suite shop");
  const dir = await tempDirectory();
  const home = kozoHome(dir.path);
  await mkdir(home.factory, { recursive: true });
  await Bun.write(join(home.factory, "factory.yml"), `repositories:\n  - { path: ${repo.path} }\n`);
  const factory = await loadFactory(home);
  const store = await EventStore.open(home);
  const agent = fakeAgent(script);
  const runner = new Runner(home, store, {
    launcher: inProcessLauncher(agent),
    judge,
    verifier: noVerifier,
    kozoCommand: "kozo",
    model: "fake",
  });
  const control = new ControlPlane(home, store, factory, runner);
  const scheduler = new Scheduler(store, runner, factory, (line) => console.error(line));
  return {
    repo,
    home,
    store,
    control,
    scheduler,
    agent,
    async settle() {
      scheduler.tick();
      await scheduler.idle();
    },
    async [Symbol.asyncDispose]() {
      await scheduler.idle();
      store.close();
      await dir[Symbol.asyncDispose]();
      await repo[Symbol.asyncDispose]();
    },
  };
}

const implement = (gatesPass = true): FakeStep[] => [
  { say: "Writing the test first." },
  { write: goodChange },
  { commit: "feat: say only N left when stock is low" },
  {
    tool: "Bash",
    input: { command: "kozo gates --level full --base main" },
    output: {
      stdout: `KOZO_GATES: level=full status=${gatesPass ? "pass" : "fail"} gates=lint,test duration=1s`,
    },
  },
  {
    use: "kozo_note",
    input: { choice: "Kept the label in one function", reason: "It is the only place" },
  },
  { answer: report },
];

describe("the minimal path", () => {
  test("an item goes from Intake through approvals, Triage and the blueprint to Handoff", async () => {
    await using env = await factoryOf((request) =>
      request.agent === "triage" ? [{ answer: plan }] : implement(),
    );
    const { ref } = await env.control.addItem({ title: "Show when only a few units are left" });
    expect(env.store.state.items[ref]?.hold?.reason).toBe("start approval");
    await env.settle();
    expect(env.agent.requests).toHaveLength(0);

    await env.control.act(ref, { kind: "item", item: { repo: null, number: 1 } }, "approve", {});
    await env.settle();
    expect(env.store.state.items[ref]).toMatchObject({
      stage: "planning",
      hold: { kind: "approval", reason: "plan approval" },
    });
    expect(env.agent.requests[0]?.agent).toBe("triage");
    expect(env.agent.requests[0]?.prompt).toContain('<request trust="untrusted">');

    await env.control.act(ref, { kind: "item", item: { repo: null, number: 1 } }, "approve", {});
    await env.settle();
    const task = env.store.state.tasks[`${ref}/t1`];
    expect(task).toMatchObject({ stage: "handoff", hold: null, revisions: 0 });
    const implementRequest = env.agent.requests[1];
    expect(implementRequest?.agent).toBe("implement");
    expect(implementRequest?.prompt).toContain(
      "GATES       Run `kozo gates --level full --base main` with Bash",
    );
    expect(await env.repo.git("log", "-1", "--format=%s %an", "kozo/K-1-t1")).toBe(
      "feat: say only N left when stock is low kozo test",
    );
    const runs = Object.values(env.store.state.runs).map((run) => [
      run.agent,
      run.state,
      run.parent,
    ]);
    expect(runs).toEqual([
      ["triage", "succeeded", null],
      ["implement", "succeeded", null],
      ["review", "succeeded", "r-0002"],
      ["verify", "succeeded", "r-0002"],
    ]);
    const nodes = env.store.db
      .query<{ node: string }, []>(
        "select json_extract(line, '$.node') as node from events where type = 'checkpoint' order by id",
      )
      .all()
      .map((row) => row.node);
    expect(nodes).toEqual([
      "claim",
      "prepare",
      "brief",
      "implement",
      "verify-deterministic",
      "review",
      "verify-app",
      "handoff",
      "final-verify",
    ]);
    const handoff = await Bun.file(join(env.home.items, ref, "handoff-t1.md")).text();
    for (const section of [
      "## Why",
      "## What changed",
      "## Out of scope",
      "## Why it is safe",
      "## Verification",
    ]) {
      expect(handoff).toContain(section);
    }
    expect(await Bun.file(runFiles(env.home, "r-0002").decisions).text()).toContain(
      "Kept the label",
    );
  }, 120_000);

  test("a deterministic failure retries in a new run with the failure, and review revise goes back to Building", async () => {
    let attempts = 0;
    await using env = await factoryOf((request) => {
      if (request.agent === "triage") return [{ answer: plan }];
      attempts += 1;
      if (attempts === 1) {
        // The fix without its test: prove refuses it.
        return [
          { write: { "src/stock.ts": goodChange["src/stock.ts"] ?? "" } },
          { commit: "fix: low stock" },
          {
            tool: "Bash",
            input: { command: "kozo gates --level full --base main" },
            output: { stdout: "KOZO_GATES: level=full status=pass gates=lint,test duration=1s" },
          },
          { use: "kozo_note", input: { choice: "a", reason: "b" } },
          { answer: report },
        ];
      }
      return implement().filter((step) => !("commit" in step) || attempts === 2);
    }, judgeWith("revise"));
    const { ref } = await env.control.addItem({ title: "Low stock", class: "docs" });
    await env.settle();
    await env.control.act(ref, { kind: "item", item: { repo: null, number: 1 } }, "approve", {});
    await env.settle();
    const task = env.store.state.tasks[`${ref}/t1`];
    expect(attempts).toBeGreaterThanOrEqual(3);
    expect(env.agent.requests[2]?.prompt).toContain("The previous attempt did not pass");
    expect(task?.revisions).toBe(2);
    expect(task?.hold).toMatchObject({ kind: "attention" });
  }, 180_000);

  test("a blocked run holds the task with its question, and an answer resumes it", async () => {
    let calls = 0;
    await using env = await factoryOf((request) => {
      if (request.agent === "triage") return [{ answer: plan }];
      calls += 1;
      if (calls === 1) {
        return [
          { use: "kozo_blocked", input: { reason: "ambiguous", question: "Does 0 say Sold out?" } },
          {
            answer: {
              ...report,
              outcome: "blocked",
              blocked: { reason: "ambiguous", question: "Does 0 say Sold out?" },
            },
          },
        ];
      }
      return implement();
    });
    const { ref } = await env.control.addItem({ title: "Low stock", class: "docs" });
    await env.settle();
    await env.control.act(ref, { kind: "item", item: { repo: null, number: 1 } }, "approve", {});
    await env.settle();
    const taskRef = `${ref}/t1`;
    expect(env.store.state.tasks[taskRef]?.hold).toMatchObject({
      kind: "question",
      reason: "ambiguous: Does 0 say Sold out?",
    });
    await env.control.act(
      taskRef,
      { kind: "task", item: { repo: null, number: 1 }, task: 1 },
      "say",
      {
        text: "Yes, 0 stays Sold out.",
      },
    );
    await env.settle();
    expect(env.store.state.tasks[taskRef]?.stage).toBe("handoff");
    expect(env.agent.requests.at(-1)?.prompt).toContain(
      "The owner said (answer): Yes, 0 stays Sold out.",
    );
  }, 120_000);

  test("reject, pause, resume, retry and close do what they say, and twice is once", async () => {
    await using env = await factoryOf((request) =>
      request.agent === "triage" ? [{ answer: plan }] : [{ hang: true }],
    );
    const item = { kind: "item", item: { repo: null, number: 1 } } as const;
    const task = { kind: "task", item: { repo: null, number: 1 }, task: 1 } as const;
    const { ref } = await env.control.addItem({ title: "Low stock", class: "docs" });
    await env.settle();
    expect(
      (await env.control.act(ref, item, "reject", { reason: "Also cover 0 units" })).message,
    ).toContain("drafts it again");
    expect((await env.control.act(ref, item, "reject", { reason: "again" })).message).toBe(
      `${ref} is not waiting for a plan approval`,
    );
    await env.settle();
    expect(env.agent.requests.at(-1)?.prompt).toContain(
      "OWNER       (rejection) Also cover 0 units",
    );
    await env.control.act(ref, item, "approve", {});
    expect((await env.control.act(ref, item, "approve", {})).message).toBe(
      `${ref} is not waiting for an approval`,
    );

    env.scheduler.tick();
    const taskRef = `${ref}/t1`;
    while (env.agent.requests.length < 3) await Bun.sleep(20);
    expect((await env.control.act(taskRef, task, "pause", { now: true })).message).toContain(
      "stopped r-",
    );
    await env.scheduler.idle();
    expect(env.store.state.tasks[taskRef]?.hold?.kind).toBe("paused");
    expect((await env.control.act(taskRef, task, "pause", {})).message).toBe(
      `${taskRef} is already paused`,
    );
    expect(Object.values(env.store.state.runs).at(-1)?.state).toBe("stopped");

    await env.control.pauseFactory();
    expect((await env.control.pauseFactory()).message).toBe("the factory is already paused");
    await env.control.act(taskRef, task, "resume", {});
    env.scheduler.tick();
    expect(env.agent.requests).toHaveLength(3);
    await env.control.resumeFactory();

    await env.control.act(taskRef, task, "close", { cancel: "not needed after all" });
    await env.scheduler.idle();
    expect(env.store.state.tasks[taskRef]?.stage).toBe("cancelled");
    expect(env.store.state.items[ref]?.stage).toBe("cancelled");
    expect(await env.repo.git("branch", "--list", "kozo/*")).toBe("");
    expect((await env.control.act(taskRef, task, "close", { done: true })).message).toBe(
      `${taskRef} is already cancelled`,
    );
    await expect(env.control.act(taskRef, task, "retry", {})).rejects.toThrow("is cancelled");
  }, 120_000);
});
