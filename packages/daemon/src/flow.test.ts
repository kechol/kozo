import { describe, expect, test } from "bun:test";
import { mkdir, realpath } from "node:fs/promises";
import { join } from "node:path";
import {
  autonomyLevel,
  kozoHome,
  parseAutomation,
  parseEvalCase,
  runFiles,
  sha256,
} from "@kozo/core";
import {
  type FakeStep,
  fakeAgent,
  gitRepository,
  goodChange,
  suiteImplement as implement,
  judgeWith,
  noVerifier,
  suitePlan as plan,
  suiteReport as report,
  suiteBase,
  suiteTask,
  tempDirectory,
  testConfine,
} from "@kozo/testing";
import type { Judge, Verifier } from "@kozo/verify";
import { type Definition, git, readDefinition } from "@kozo/verify";
import type { AgentRequest } from "@kozo/worker";
import { Automations } from "./automations.ts";
import { ControlPlane } from "./control-plane.ts";
import { evalCaseOf } from "./eval.ts";
import { EventStore } from "./event-store.ts";
import { inProcessLauncher, type Launcher } from "./launcher.ts";
import { list } from "./queries.ts";
import { Reconciler } from "./reconcile.ts";
import { buildReport, type Failure } from "./report.ts";
import { readCharter } from "./repository.ts";
import { Runner } from "./runner.ts";
import { Scheduler } from "./scheduler.ts";
import { worktreePath } from "./worktrees.ts";

/** The failures `kozo report --days 7` lists for a test factory. */
async function weekFailures(env: { store: EventStore; definition: { current: Definition } }) {
  const report = await buildReport(
    env.store.db,
    env.store.state,
    env.definition.current.factory,
    "summary",
    7,
  );
  return (report as { failures: Failure[] }).failures;
}

async function factoryOf(
  script: (request: AgentRequest) => FakeStep[],
  judge: Judge = judgeWith("accept"),
  options: {
    charter?: (text: string) => string;
    constraints?: (text: string) => string;
    factory?: string;
    now?: () => Date;
    launcher?: (fallback: Launcher) => Launcher;
    verifier?: Verifier;
  } = {},
) {
  const repo = await gitRepository();
  const charter = suiteBase[".kozo/charter.yml"] ?? "";
  const constraints = suiteBase[".kozo/constraints.yml"] ?? "";
  await repo.commit(
    {
      ...suiteBase,
      ".kozo/charter.yml": options.charter ? options.charter(charter) : charter,
      ".kozo/constraints.yml": options.constraints ? options.constraints(constraints) : constraints,
    },
    "the suite shop",
  );
  const dir = await tempDirectory();
  const home = kozoHome(dir.path);
  await mkdir(home.factory, { recursive: true });
  await Bun.write(
    join(home.factory, "factory.yml"),
    `repositories:\n  - { path: ${repo.path} }\n${options.factory ?? ""}`,
  );
  const loaded = await readDefinition(home.factory, null);
  if (!loaded.ok) throw new Error(loaded.issues.join("; "));
  const definition = { current: loaded.definition };
  const store = await EventStore.open(home);
  const agent = fakeAgent(script);
  const inProcess = inProcessLauncher(agent, testConfine);
  const runner = new Runner(home, store, {
    launcher: options.launcher ? options.launcher(inProcess) : inProcess,
    judge,
    verifier: options.verifier ?? noVerifier,
    definition,
    confine: testConfine,
  });
  const control = new ControlPlane(home, store, definition, runner);
  const scheduler = new Scheduler(
    store,
    runner,
    definition,
    (line) => console.error(line),
    options.now,
  );
  const reconciler = new Reconciler(
    store,
    runner,
    (line) => console.error(line),
    (ref, work) => scheduler.startWork(ref, work),
  );
  return {
    repo,
    home,
    store,
    definition,
    control,
    scheduler,
    reconciler,
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

describe("feature items", () => {
  const feature = { ...plan, plan: { ...plan.plan, class: "feature" } };
  const item = { kind: "item", item: { repo: null, number: 1 } } as const;

  test("the plan agent settles a feature's acceptance criteria with the owner before its approval", async () => {
    let asked = false;
    await using env = await factoryOf(
      (request) => {
        if (request.agent === "triage") return [{ answer: feature }];
        if (request.agent !== "plan") return implement();
        if (asked) return [{ answer: feature }];
        asked = true;
        return [{ answer: { outcome: "question", question: "Does 0 say Sold out?" } }];
      },
      judgeWith("accept"),
      { charter: (text) => text.replace("default: L1", "default: L2") },
    );
    const { ref } = await env.control.addItem({ title: "Say when only a few units are left" });
    await env.settle();
    expect(env.agent.requests.map((request) => request.agent)).toEqual(["triage", "plan"]);
    expect(env.store.state.items[ref]).toMatchObject({
      stage: "planning",
      hold: { kind: "question", reason: "Does 0 say Sold out?" },
    });
    const moved = env.store.db
      .query<{ reason: string }, []>(
        "select json_extract(line, '$.data.reason') as reason from events where type = 'stage.changed' and json_extract(line, '$.data.to') = 'planning'",
      )
      .get();
    expect(moved?.reason).toBe(
      "the plan needs an approval at L2; the plan agent first works out its acceptance criteria with the owner",
    );

    await env.control.act(ref, item, "say", { text: "Yes, 0 says Sold out." });
    await env.settle();
    expect(env.agent.requests.at(-1)?.prompt).toContain(
      "OWNER       (answer) Yes, 0 says Sold out.",
    );
    expect(env.store.state.items[ref]).toMatchObject({
      stage: "planning",
      hold: { kind: "approval", reason: "plan approval" },
    });
    await env.control.act(ref, item, "approve", {});
    await env.settle();
    expect(env.store.state.items[ref]?.acceptedBy).toBe("human");
    expect(env.store.state.tasks[`${ref}/t1`]).toMatchObject({ stage: "handoff", hold: null });
  }, 120_000);

  test("a single feature task at L3 is accepted as triage drafted it, like any other class", async () => {
    await using env = await factoryOf(
      (request) => (request.agent === "triage" ? [{ answer: feature }] : implement()),
      judgeWith("accept"),
      { charter: (text) => text.replace("default: L1", "default: L3") },
    );
    const { ref } = await env.control.addItem({ title: "Say when only a few units are left" });
    await env.settle();
    expect(env.agent.requests.some((request) => request.agent === "plan")).toBe(false);
    expect(env.store.state.items[ref]).toMatchObject({ acceptedBy: "kozod" });
    expect(env.store.state.tasks[`${ref}/t1`]?.stage).toBe("handoff");
  }, 120_000);
});

describe("the retrospective", () => {
  test("a block for a missing tool is a failure of the week", async () => {
    const question = "Playwright's browsers are not installed";
    await using env = await factoryOf((request) =>
      request.agent === "triage"
        ? [{ answer: plan }]
        : [
            { use: "kozo_blocked", input: { reason: "missing-tool", question } },
            {
              answer: {
                ...report,
                outcome: "blocked",
                blocked: { reason: "missing-tool", question },
              },
            },
          ],
    );
    const { ref } = await env.control.addItem({ title: "Low stock", class: "docs" });
    await env.settle();
    await env.control.act(ref, { kind: "item", item: { repo: null, number: 1 } }, "approve", {});
    await env.settle();
    const week = { failures: await weekFailures(env) };
    expect(week.failures).toEqual([
      { kind: "missing-tool", ref: `${ref}/t1`, at: expect.any(String), text: question },
    ]);
    const held = env.store.db
      .query<{ blocked: string }, []>(
        "select json_extract(line, '$.data.blocked') as blocked from events where type = 'hold.set' and json_extract(line, '$.data.hold') = 'question'",
      )
      .get();
    expect(held?.blocked).toBe("missing-tool");
  }, 120_000);
});

describe("splitting again", () => {
  test("a task stopped for its scope sends its item back to Planning, and the rest stays", async () => {
    const readme = "The README says when Only N left appears";
    const estimate = { lines: 20, files: 1 };
    const split = {
      outcome: "plan",
      plan: {
        ...plan.plan,
        done_when: [...suiteTask.doneWhen, readme],
        tasks: [
          { ...plan.plan.tasks[0], id: "t1" },
          {
            id: "t2",
            goal: "Document it",
            done_when: [readme],
            scope: ["docs/**"],
            depends_on: [],
            estimate,
          },
          {
            id: "t3",
            goal: "Link it",
            done_when: [readme],
            scope: ["site/**"],
            depends_on: ["t2"],
            estimate,
          },
        ],
      },
    };
    const question = "The wording is documented in README.md, outside docs/**";
    const proposed = [
      { goal: "Document it in the README", done_when: [readme], scope: ["README.md"] },
    ];
    const again = {
      outcome: "plan",
      plan: {
        ...plan.plan,
        done_when: [readme],
        tasks: [
          {
            id: "t1",
            goal: "Document it in the README",
            done_when: [readme],
            scope: ["README.md"],
            depends_on: [],
            estimate,
          },
        ],
      },
    };
    await using env = await factoryOf(
      (request) => {
        if (request.agent === "triage") return [{ answer: split }];
        if (request.agent === "plan") return [{ answer: again }];
        if (!request.prompt.includes("docs/**")) return implement();
        return [
          { use: "kozo_blocked", input: { reason: "scope", question, split: proposed } },
          {
            answer: {
              ...report,
              outcome: "blocked",
              blocked: { reason: "scope", question, split: proposed },
            },
          },
        ];
      },
      judgeWith("accept"),
      { charter: (text) => text.replace("default: L1", "default: L3") },
    );
    const item = { kind: "item", item: { repo: null, number: 1 } } as const;
    const { ref } = await env.control.addItem({ title: "Low stock" });
    await env.settle();
    await env.control.act(ref, item, "approve", {});
    await env.settle();

    const stages = () =>
      Object.fromEntries(
        env.store.state.items[ref]?.tasks.map((task) => [
          task,
          env.store.state.tasks[task]?.stage,
        ]) ?? [],
      );
    expect(stages()).toEqual({
      [`${ref}/t1`]: "handoff",
      [`${ref}/t2`]: "cancelled",
      [`${ref}/t3`]: "cancelled",
    });
    // Even at L3 the new split waits for the owner.
    expect(env.store.state.items[ref]).toMatchObject({
      stage: "planning",
      hold: { kind: "approval", reason: "plan approval" },
    });
    const prompt = env.agent.requests.findLast((request) => request.agent === "plan")?.prompt ?? "";
    expect(prompt).toContain('TASKS       <request trust="untrusted">');
    const tasks = JSON.parse(
      prompt
        .slice(prompt.indexOf('TASKS       <request trust="untrusted">') + 39)
        .split("\n</request>")[0] ?? "",
    );
    expect(tasks).toEqual([
      expect.objectContaining({ ref: `${ref}/t1`, stage: "handoff" }),
      expect.objectContaining({
        ref: `${ref}/t2`,
        stage: "cancelled",
        stopped: { question, split: proposed },
      }),
      { ref: `${ref}/t3`, stage: "cancelled", goal: "Link it", scope: ["site/**"] },
    ]);
    expect(await env.repo.git("branch", "--list", `kozo/${env.store.factoryId}/K-1-t2`)).toBe("");

    await env.control.pauseFactory();
    await env.control.act(ref, item, "approve", {});
    expect(env.store.state.items[ref]?.stage).toBe("building");
    expect(env.store.state.tasks[`${ref}/t4`]).toMatchObject({
      stage: "building",
      scope: ["README.md"],
    });
    expect(env.store.state.tasks[`${ref}/t1`]?.stage).toBe("handoff");
  }, 120_000);
});

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
      "GATES       Call kozo_gates with level full; it must pass on your last commit.",
    );
    expect(
      await env.repo.git("log", "-1", "--format=%s %an", `kozo/${env.store.factoryId}/K-1-t1`),
    ).toBe("feat: say only N left when stock is low kozo test");
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
    const data = (type: string, run: string) =>
      JSON.parse(
        env.store.db
          .query<{ line: string }, [string, string]>(
            "select line from events where type = ? and run_id = ?",
          )
          .get(type, run)?.line ?? "{}",
      ).data;
    expect(data("run.started", "r-0002")).toMatchObject({
      runtime: "sdk",
      kozo_version: expect.any(String),
      request_sha: sha256("# Show when only a few units are left\n\n"),
    });
    expect(data("session.started", "r-0002")).toMatchObject({
      claude_version: "fake",
      brief_sha: sha256(await Bun.file(runFiles(env.home, "r-0002").brief).text()),
    });
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
          { use: "kozo_gates", input: { level: "full" } },
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
    const week = { failures: await weekFailures(env) };
    expect(week.failures.filter((failure) => failure.kind === "revise")).toHaveLength(2);
    expect(week.failures[0]).toMatchObject({ kind: "revise", ref: `${ref}/t1` });
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

  test("an answer to a diff-guard refusal reaches the agent with the refusal", async () => {
    let calls = 0;
    await using env = await factoryOf((request) => {
      if (request.agent === "triage") return [{ answer: plan }];
      calls += 1;
      if (calls > 1) return [{ write: { "scripts/extra.ts": null } }, ...implement().slice(2)];
      const [say, , ...rest] = implement();
      return [
        ...(say ? [say] : []),
        { write: { ...goodChange, "scripts/extra.ts": "export {};\n" } },
        ...rest,
      ];
    });
    const { ref } = await env.control.addItem({ title: "Low stock", class: "docs" });
    await env.settle();
    await env.control.act(ref, { kind: "item", item: { repo: null, number: 1 } }, "approve", {});
    await env.settle();
    const taskRef = `${ref}/t1`;
    expect(env.store.state.tasks[taskRef]?.hold?.reason).toStartWith("diff-guard refused the diff");
    await env.control.act(
      taskRef,
      { kind: "task", item: { repo: null, number: 1 }, task: 1 },
      "say",
      { text: "Leave scripts/ alone." },
    );
    await env.settle();
    expect(env.store.state.tasks[taskRef]?.stage).toBe("handoff");
    const prompt = env.agent.requests.at(-1)?.prompt ?? "";
    expect(prompt).toContain("The owner said (answer): Leave scripts/ alone.");
    expect(prompt).toContain("The previous attempt did not pass: KOZO_DIFF_GUARD: status=fail");
  }, 120_000);

  test("reject, pause, resume, retry and close do what they say, and twice is once", async () => {
    await using env = await factoryOf((request) =>
      request.agent === "triage" || request.agent === "plan"
        ? [{ answer: plan }]
        : [{ hang: true }],
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
    expect(env.agent.requests.at(-1)?.agent).toBe("plan");
    expect(env.agent.requests.at(-1)?.prompt).toContain(
      "OWNER       (rejection) Also cover 0 units",
    );
    expect(env.agent.requests.at(-1)?.prompt).toContain('DRAFT       <request trust="untrusted">');
    expect(env.store.state.items[ref]).toMatchObject({
      stage: "planning",
      hold: { kind: "approval", reason: "plan approval" },
    });
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
    // A refused retry leaves no instruction for the next run.
    const notes = env.store.state.items[ref]?.notes.length;
    await expect(
      env.control.act(taskRef, task, "retry", { text: "Try the other label" }),
    ).rejects.toThrow("is held by paused");
    expect(env.store.state.items[ref]?.notes.length).toBe(notes);

    await env.control.pauseFactory();
    expect((await env.control.pauseFactory()).message).toBe("the factory is already paused");
    await env.control.act(taskRef, task, "resume", {});
    env.scheduler.tick();
    expect(env.agent.requests).toHaveLength(3);
    await env.control.resumeFactory();

    await env.control.act(taskRef, task, "pause", {});
    await env.control.act(taskRef, task, "close", { cancel: "not needed after all" });
    await env.scheduler.idle();
    expect(env.store.state.tasks[taskRef]?.stage).toBe("cancelled");
    expect(env.store.state.tasks[taskRef]?.hold).toBeNull();
    expect(env.store.state.items[ref]?.stage).toBe("cancelled");
    expect(await env.repo.git("branch", "--list", "kozo/*")).toBe("");
    expect((await env.control.act(taskRef, task, "close", { done: true })).message).toBe(
      `${taskRef} is already cancelled`,
    );
    await expect(env.control.act(taskRef, task, "retry", {})).rejects.toThrow("is cancelled");
  }, 120_000);

  test("a spent daily budget holds new work for capacity until the next day", async () => {
    let now = new Date();
    await using env = await factoryOf(
      (request) => (request.agent === "triage" ? [{ spend: 0.5 }, { answer: plan }] : implement()),
      judgeWith("accept"),
      { factory: "budget: { daily_usd: 0.4 }\n", now: () => now },
    );
    const { ref } = await env.control.addItem({ title: "Low stock", class: "docs" });
    await env.settle();
    await env.control.act(ref, { kind: "item", item: { repo: null, number: 1 } }, "approve", {});
    await env.settle();
    const taskRef = `${ref}/t1`;
    expect(env.store.state.tasks[taskRef]?.hold).toMatchObject({
      kind: "capacity",
      reason: "the daily budget of 0.4 USD is spent",
    });
    now = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    await env.settle();
    expect(env.store.state.tasks[taskRef]).toMatchObject({ stage: "handoff", hold: null });
  }, 120_000);

  test("a running session holds back its limit, so a second one waits for it", async () => {
    // The fixtures' Charter lets a session spend 5 USD.
    let triages = 0;
    await using env = await factoryOf(
      (request) =>
        request.agent === "triage" && triages++ === 0 ? [{ hang: true }] : [{ answer: plan }],
      judgeWith("accept"),
      { factory: "budget: { daily_usd: 5 }\n" },
    );
    const first = await env.control.addItem({ title: "Low stock", class: "docs" });
    await env.control.addItem({ title: "Sold out", class: "docs" });
    env.scheduler.tick();
    while (env.agent.requests.length < 1) await Bun.sleep(20);
    env.scheduler.tick();
    await Bun.sleep(200);
    expect(env.agent.requests).toHaveLength(1);
    await env.control.act(first.ref, { kind: "item", item: { repo: null, number: 1 } }, "pause", {
      now: true,
    });
    await env.settle();
    expect(env.agent.requests).toHaveLength(2);
  }, 120_000);

  test("the worktree is back at HEAD after verify-app, with what its session left named", async () => {
    const doneWhen = plan.plan.tasks[0]?.done_when ?? [];
    const verifier: Verifier = {
      async verify(request) {
        await Bun.write(join(request.cwd, ".output", "verify", "01-label.txt"), "Only 3 left\n");
        await Bun.write(join(request.cwd, "src", "probe.ts"), "export {};\n");
        const output = {
          result: "pass",
          summary: "The label shows.",
          conditions: doneWhen.map((condition) => ({
            condition,
            met: true,
            observation: "The page says Only 3 left.",
            evidence: [".output/verify/01-label.txt"],
          })),
          cleanedUp: true,
        };
        return { output, model: request.model, costUsd: 0.01 };
      },
    };
    await using env = await factoryOf(
      (request) => (request.agent === "triage" ? [{ answer: plan }] : implement()),
      judgeWith("accept"),
      { verifier },
    );
    await env.repo.commit({ ".kozo/verify-app.md": "# Verify the app\n\nRun it.\n" }, "verify");
    const { ref } = await env.control.addItem({ title: "Low stock", class: "docs" });
    await env.settle();
    await env.control.act(ref, { kind: "item", item: { repo: null, number: 1 } }, "approve", {});
    await env.settle();
    const task = `${ref}/t1`;
    expect(env.store.state.tasks[task]).toMatchObject({ stage: "handoff", hold: null });
    const worktree = worktreePath(env.home, env.repo.path, task);
    expect((await git(worktree, ["status", "--porcelain", "--untracked-files=all"])).trim()).toBe(
      "",
    );
    const exit = env.store.db
      .query<{ summary: string }, []>(
        "select json_extract(line, '$.data.summary') as summary from events where type = 'node.exit' and json_extract(line, '$.node') = 'verify-app'",
      )
      .get();
    expect(exit?.summary).toContain("src/probe.ts");
  }, 120_000);

  test("closing a task as done removes its worktree and markers and keeps its branch", async () => {
    await using env = await factoryOf(
      (request) => (request.agent === "triage" ? [{ answer: plan }] : implement()),
      judgeWith("accept"),
      { constraints: (text) => `${text}ports: 1\n` },
    );
    const { ref } = await env.control.addItem({ title: "Low stock", class: "docs" });
    await env.settle();
    await env.control.act(ref, { kind: "item", item: { repo: null, number: 1 } }, "approve", {});
    await env.settle();
    const task = `${ref}/t1`;
    const worktree = worktreePath(env.home, env.repo.path, task);
    expect(env.store.state.tasks[task]?.stage).toBe("handoff");
    expect(await Bun.file(`${worktree}.prepared`).exists()).toBe(true);
    expect(await Bun.file(`${worktree}.ports`).exists()).toBe(true);
    const reference = { kind: "task", item: { repo: null, number: 1 }, task: 1 } as const;
    await env.control.act(task, reference, "close", { done: true });
    expect(env.store.state.tasks[task]?.stage).toBe("complete");
    for (const path of [join(worktree, "README.md"), `${worktree}.prepared`, `${worktree}.ports`])
      expect({ path, exists: await Bun.file(path).exists() }).toEqual({ path, exists: false });
    expect(await env.repo.git("branch", "--list", "kozo/*")).not.toBe("");
  }, 120_000);

  test("a MISCONFIGURED prove holds the task at once instead of retrying", async () => {
    await using env = await factoryOf(
      (request) => (request.agent === "triage" ? [{ answer: plan }] : implement()),
      judgeWith("accept"),
      {
        constraints: (text) => {
          const prove = text.indexOf("prove:");
          expect(prove).toBeGreaterThan(0);
          return `${text.slice(0, prove)}prove: []\n`;
        },
      },
    );
    const { ref } = await env.control.addItem({ title: "Low stock", class: "docs" });
    await env.settle();
    await env.control.act(ref, { kind: "item", item: { repo: null, number: 1 } }, "approve", {});
    await env.settle();
    const task = env.store.state.tasks[`${ref}/t1`];
    expect(task?.hold).toMatchObject({
      kind: "attention",
      reason: "prove is MISCONFIGURED: no-prove-entries",
    });
    expect(env.agent.requests.filter((request) => request.agent === "implement")).toHaveLength(1);
  }, 120_000);

  test("the inbox shows a task awaiting merge only once its final verification passed", async () => {
    // The deep gates of final-verify alone take a while, so the task sits in Handoff meanwhile.
    await using env = await factoryOf(
      (request) => (request.agent === "triage" ? [{ answer: plan }] : implement()),
      judgeWith("accept"),
      {
        constraints: (text) =>
          text
            .replace("gates:\n", "gates:\n  settle:\n    run: sleep 3\n")
            .replace("deep: [lint, test]", "deep: [settle, lint, test]"),
      },
    );
    const merges = () =>
      (list(env.store.db, "inbox") as { ref: string; waiting: string }[]).filter(
        (row) => row.waiting === "merge",
      );
    const { ref } = await env.control.addItem({ title: "Low stock", class: "docs" });
    await env.settle();
    await env.control.act(ref, { kind: "item", item: { repo: null, number: 1 } }, "approve", {});
    env.scheduler.tick();
    const task = `${ref}/t1`;
    for (let waited = 0; env.store.state.tasks[task]?.stage !== "handoff"; waited += 20) {
      if (waited > 60_000) throw new Error("the task never reached Handoff");
      await Bun.sleep(20);
    }
    expect(env.store.state.tasks[task]?.hold).toBeNull();
    expect(merges()).toEqual([]);
    await env.scheduler.idle();
    expect(merges()).toEqual([expect.objectContaining({ ref: task })]);
  }, 120_000);

  test("tasks awaiting a merge at the Charter's limit stop new triage and hold waiting tasks", async () => {
    await using env = await factoryOf(
      (request) => (request.agent === "triage" ? [{ answer: plan }] : implement()),
      judgeWith("accept"),
      { charter: (text) => text.replace("max_awaiting_merge: 3", "max_awaiting_merge: 1") },
    );
    const item = (number: number) => ({ kind: "item", item: { repo: null, number } }) as const;
    await env.control.addItem({ title: "First", class: "docs" });
    await env.settle();
    await env.control.act("K-1", item(1), "approve", {});
    await env.settle();
    expect(env.store.state.tasks["K-1/t1"]?.stage).toBe("handoff");
    await env.control.addItem({ title: "Second", class: "docs" });
    await env.settle();
    expect(env.store.state.items["K-2"]).toMatchObject({ stage: "triage", hold: null });
    expect(env.agent.requests.map((request) => request.agent)).toEqual(["triage", "implement"]);
    await env.control.act(
      "K-1/t1",
      { kind: "task", item: { repo: null, number: 1 }, task: 1 },
      "close",
      {
        done: true,
      },
    );
    await env.settle();
    expect(env.store.state.items["K-2"]?.stage).toBe("planning");
  }, 180_000);

  test("a repository whose Charter is no longer ready starts nothing and says why", async () => {
    await using env = await factoryOf((request) =>
      request.agent === "triage" ? [{ answer: plan }] : implement(),
    );
    const { ref } = await env.control.addItem({ title: "Low stock", class: "docs" });
    await env.settle();
    const charter = suiteBase[".kozo/charter.yml"] ?? "";
    await env.repo.commit({
      ".kozo/charter.yml": charter.replace("status: ready", "status: incomplete"),
    });
    await env.control.act(ref, { kind: "item", item: { repo: null, number: 1 } }, "approve", {});
    await env.settle();
    expect(env.store.state.tasks[`${ref}/t1`]?.hold).toMatchObject({
      kind: "capacity",
      reason: expect.stringContaining("incomplete, not ready"),
    });
    expect(env.agent.requests.map((request) => request.agent)).toEqual(["triage"]);
  }, 120_000);

  test("services start outside the command sandbox before prepare, and a failing one holds the task", async () => {
    await using marks = await tempDirectory();
    const mark = join(await realpath(marks.path), "db-up");
    const withServices = (services: string) => ({
      constraints: (text: string) =>
        text.replace(
          "version: 1\n",
          `version: 1\nservices: [${services}]\nprepare: ["test -f '${mark}'"]\n`,
        ),
    });
    const approveAll = async (env: Awaited<ReturnType<typeof factoryOf>>) => {
      const { ref } = await env.control.addItem({ title: "Low stock" });
      for (let pass = 0; pass < 2; pass++) {
        await env.settle();
        await env.control.act(
          ref,
          { kind: "item", item: { repo: null, number: 1 } },
          "approve",
          {},
        );
      }
      await env.settle();
      return env.store.state.tasks[`${ref}/t1`];
    };
    // Outside the worktree only a command outside the sandbox can write the mark prepare looks for.
    {
      await using env = await factoryOf(
        (request) => (request.agent === "triage" ? [{ answer: plan }] : implement()),
        judgeWith("accept"),
        withServices(`"echo up > '${mark}'"`),
      );
      expect(await approveAll(env)).toMatchObject({ stage: "handoff", hold: null });
      expect(await Bun.file(mark).text()).toBe("up\n");
    }
    {
      await using env = await factoryOf(
        (request) => (request.agent === "triage" ? [{ answer: plan }] : implement()),
        judgeWith("accept"),
        withServices('"exit 3"'),
      );
      expect((await approveAll(env))?.hold).toMatchObject({
        kind: "attention",
        reason: "prepare failed: exit 3 exited with 3",
      });
    }
  }, 120_000);

  test("triage's work class cannot raise the autonomy level above the one asked for", async () => {
    await using env = await factoryOf(
      (request) =>
        request.agent === "triage"
          ? [{ answer: { ...plan, plan: { ...plan.plan, class: "docs" } } }]
          : implement(),
      judgeWith("accept"),
      { charter: (text) => text.replace("docs: L2", "docs: L3") },
    );
    const { ref } = await env.control.addItem({ title: "Low stock" });
    await env.control.act(ref, { kind: "item", item: { repo: null, number: 1 } }, "approve", {});
    await env.settle();
    expect(env.store.state.items[ref]).toMatchObject({
      stage: "planning",
      hold: { kind: "approval", reason: "plan approval" },
    });
  }, 120_000);

  async function toHandoff(env: Awaited<ReturnType<typeof factoryOf>>) {
    const { ref } = await env.control.addItem({ title: "Low stock", class: "docs" });
    await env.settle();
    await env.control.act(ref, { kind: "item", item: { repo: null, number: 1 } }, "approve", {});
    await env.settle();
    expect(env.store.state.tasks[`${ref}/t1`]?.stage).toBe("handoff");
    return { ref, task: `${ref}/t1` };
  }

  test("a merged task is checked at Complete and completes its item", async () => {
    await using env = await factoryOf((request) =>
      request.agent === "triage" ? [{ answer: plan }] : implement(),
    );
    const { ref, task } = await toHandoff(env);
    await env.reconciler.reconcile();
    await env.scheduler.idle();
    expect(env.store.state.tasks[task]?.stage).toBe("handoff");
    await env.repo.git(
      "merge",
      "--no-ff",
      "--quiet",
      "-m",
      "merge the low stock notice",
      `kozo/${env.store.factoryId}/K-1-t1`,
    );
    const tip = (await env.repo.git("rev-parse", `kozo/${env.store.factoryId}/K-1-t1`)).trim();
    const mergeCommit = (await env.repo.git("rev-parse", "HEAD")).trim();
    await env.reconciler.reconcile();
    await env.scheduler.idle();
    expect(env.store.state.tasks[task]?.stage).toBe("complete");
    expect(env.store.state.items[ref]?.stage).toBe("complete");
    expect(await env.repo.git("worktree", "list")).not.toContain("K-1-t1");
    const factory = env.definition.current.factory;
    expect(await buildReport(env.store.db, env.store.state, factory, "review")).toMatchObject({
      days: 30,
      merged: 1,
      autonomy_rate: 1,
      defect_rate: 0,
      reviews: 1,
      revise_rate: 0,
      held: 0,
      promotions: [],
      levels: expect.arrayContaining([{ repository: env.repo.path, class: "docs", level: "L2" }]),
    });
    const first = Object.keys(env.store.state.runs)[0] ?? "";
    const drafted = await evalCaseOf(env.home, env.store, first);
    expect(drafted.evalCase).toMatchObject({
      repository: env.repo.path,
      request: { title: "Low stock" },
      expected: { outcome: "complete", reference: mergeCommit },
    });
    expect(parseEvalCase(Bun.YAML.stringify(drafted.evalCase)).ok).toBe(true);
    const reported = await buildReport(env.store.db, env.store.state, factory, "summary");
    expect((reported as { hours_to_merge: number }).hours_to_merge).toBeGreaterThanOrEqual(0);
    expect((reported as { cost_per_diff_usd: number }).cost_per_diff_usd).toBeGreaterThanOrEqual(0);
    const events = (type: string) =>
      env.store.db
        .query<{ line: string }, [string]>("select line from events where type = ? order by id")
        .all(type)
        .map((row) => JSON.parse(row.line));
    expect(events("handoff.ready").at(-1)?.data).toMatchObject({
      branch: `kozo/${env.store.factoryId}/K-1-t1`,
      head: tip,
      report: "items/K-1/handoff-t1.md",
    });
    expect(events("branch.merged")).toMatchObject([
      {
        task,
        data: {
          branch: `kozo/${env.store.factoryId}/K-1-t1`,
          head: tip,
          into: "main",
          commit: mergeCommit,
        },
      },
    ]);
    expect(events("branch.merged")[0]?.data.committer).toEndWith("@example.com>");
    const check = events("gates.result").at(-1);
    expect(check).toMatchObject({ node: "complete", data: { head: mergeCommit } });
    expect(await Bun.file(join(env.home.root, check?.data.output_path)).exists()).toBe(true);
  }, 180_000);

  test("a merged task's check takes the next free slot before new work", async () => {
    await using env = await factoryOf((request) =>
      request.agent === "triage" ? [{ answer: plan }] : implement(),
    );
    const { ref, task } = await toHandoff(env);
    await env.repo.git(
      "merge",
      "--no-ff",
      "--quiet",
      "-m",
      "merge",
      `kozo/${env.store.factoryId}/K-1-t1`,
    );
    // The reconciler found the merge while every slot was taken, so it could not start the check.
    await env.store.append({
      type: "branch.merged",
      item: ref,
      task,
      data: {
        branch: `kozo/${env.store.factoryId}/K-1-t1`,
        head: (await env.repo.git("rev-parse", `kozo/${env.store.factoryId}/K-1-t1`)).trim(),
        into: "main",
        commit: (await env.repo.git("rev-parse", "HEAD")).trim(),
        committer: null,
      },
    });
    await env.control.addItem({ title: "Another change", class: "bugfix" });
    env.scheduler.tick();
    await env.scheduler.idle();
    expect(env.store.state.tasks[task]?.stage).toBe("complete");
    expect(env.store.state.items[ref]?.stage).toBe("complete");
  }, 180_000);

  test("a squashed merge is found by its patch, and the commit that applied it is recorded", async () => {
    // Two commits, so that no single one has the squash's patch.
    const [first, ...rest] = Object.entries(goodChange);
    await using env = await factoryOf((request) =>
      request.agent === "triage"
        ? [{ answer: plan }]
        : [
            { write: Object.fromEntries(first ? [first] : []) },
            { commit: "test: the low stock wording" },
            { write: Object.fromEntries(rest) },
            ...implement().slice(2),
          ],
    );
    const { task } = await toHandoff(env);
    await env.repo.commit({ "NOTES.txt": "unrelated\n" }, "an unrelated change");
    await env.repo.git("merge", "--squash", "--quiet", `kozo/${env.store.factoryId}/K-1-t1`);
    await env.repo.git("commit", "--quiet", "-m", "the low stock notice, squashed");
    const squashed = (await env.repo.git("rev-parse", "HEAD")).trim();
    await env.repo.commit({ "LATER.txt": "later\n" }, "a later change");
    await env.reconciler.reconcile();
    await env.scheduler.idle();
    expect(env.store.state.tasks[task]).toMatchObject({
      stage: "complete",
      merged: { commit: squashed },
    });
  }, 180_000);

  test("a failing check after the merge is a defect that sends the item back to Triage", async () => {
    await using env = await factoryOf((request) =>
      request.agent === "triage" ? [{ answer: plan }] : implement(),
    );
    const { ref, task } = await toHandoff(env);
    await env.control.pauseFactory();
    await env.repo.git(
      "merge",
      "--no-ff",
      "--quiet",
      "-m",
      "merge",
      `kozo/${env.store.factoryId}/K-1-t1`,
    );
    await env.repo.commit({ "src/debug.ts": "console.log('left over');\n" }, "debug");
    await env.reconciler.reconcile();
    await env.scheduler.idle();
    expect(env.store.state.tasks[task]?.stage).toBe("complete");
    expect(env.store.state.items[ref]).toMatchObject({ stage: "triage", hold: null });
    expect(env.store.state.items[ref]?.notes.at(-1)).toMatchObject({
      target: task,
      kind: "check",
      text: expect.stringContaining("DONE_WHEN is not met"),
    });
    expect(env.store.state.tasks[task]?.defectAt).not.toBeNull();
  }, 180_000);

  test("an item whose other task was cancelled completes once its last task merges", async () => {
    const docs = "The docs mention the low-stock notice";
    const both = {
      ...plan,
      plan: {
        ...plan.plan,
        done_when: [...suiteTask.doneWhen, docs],
        tasks: [
          plan.plan.tasks[0],
          {
            id: "t2",
            goal: "Mention it in the docs",
            done_when: [docs],
            scope: ["docs/**"],
            depends_on: [],
            estimate: { lines: 5, files: 1 },
          },
        ],
      },
    };
    const question = "Which page of the docs?";
    await using env = await factoryOf((request) => {
      if (request.agent === "triage") return [{ answer: both }];
      if (!request.prompt.includes("docs/**")) return implement();
      return [
        { use: "kozo_blocked", input: { reason: "ambiguous", question } },
        { answer: { ...report, outcome: "blocked", blocked: { reason: "ambiguous", question } } },
      ];
    });
    const item = { kind: "item", item: { repo: null, number: 1 } } as const;
    const { ref } = await env.control.addItem({ title: "Low stock", class: "docs" });
    await env.settle();
    await env.control.act(ref, item, "approve", {});
    await env.settle();
    await env.control.act(ref, item, "approve", {});
    await env.settle();
    const t2 = { kind: "task", item: { repo: null, number: 1 }, task: 2 } as const;
    await env.control.act(`${ref}/t2`, t2, "close", { cancel: "not needed" });
    expect(env.store.state.tasks[`${ref}/t1`]?.stage).toBe("handoff");
    await env.repo.git(
      "merge",
      "--no-ff",
      "--quiet",
      "-m",
      "merge",
      `kozo/${env.store.factoryId}/K-1-t1`,
    );
    await env.reconciler.reconcile();
    await env.scheduler.idle();
    expect(env.store.state.tasks[`${ref}/t1`]?.stage).toBe("complete");
    expect(env.store.state.items[ref]?.stage).toBe("complete");
  }, 180_000);

  test("a post-merge defect lowers its class one level until the Charter changes", async () => {
    await using env = await factoryOf(
      (request) => (request.agent === "triage" ? [{ answer: plan }] : implement()),
      judgeWith("accept"),
      { charter: (text) => text.replace("default: L1", "default: L1\n  bugfix: L2") },
    );
    const { task } = await toHandoff(env);
    await env.control.pauseFactory();
    await env.repo.git(
      "merge",
      "--no-ff",
      "--quiet",
      "-m",
      "merge",
      `kozo/${env.store.factoryId}/K-1-t1`,
    );
    await env.repo.commit({ "src/debug.ts": "console.log('left over');\n" }, "debug");
    await env.reconciler.reconcile();
    await env.scheduler.idle();
    await env.reconciler.reconcile();
    expect(Object.values(env.store.state.demotions)).toEqual([
      expect.objectContaining({
        repository: env.repo.path,
        class: "bugfix",
        from: "L2",
        to: "L1",
        reason: `a post-merge defect in ${task}`,
      }),
    ]);
    const charter = await readCharter(env.repo.path, "local", env.store.state);
    expect(charter.ok && autonomyLevel(charter.charter, "bugfix")).toBe("L1");
    await env.repo.commit(
      {
        ".kozo/charter.yml": `${await env.repo.git("show", "HEAD:.kozo/charter.yml")}\n# reviewed\n`,
      },
      "charter",
    );
    const edited = await readCharter(env.repo.path, "local", env.store.state);
    expect(edited.ok && autonomyLevel(edited.charter, "bugfix")).toBe("L2");
    const week = { failures: await weekFailures(env) };
    expect(week.failures).toContainEqual(expect.objectContaining({ kind: "defect", ref: task }));
  }, 180_000);

  test("a failing check after merging a task that is not the item's last holds it and its dependents", async () => {
    const split = {
      ...plan,
      plan: {
        ...plan.plan,
        tasks: [
          plan.plan.tasks[0],
          {
            ...plan.plan.tasks[0],
            id: "t2",
            goal: "Mention the low-stock notice in the docs",
            done_when: ["The docs mention the low-stock notice"],
            scope: ["docs/**"],
            depends_on: ["t1"],
          },
        ],
      },
    };
    await using env = await factoryOf((request) =>
      request.agent === "triage" ? [{ answer: split }] : implement(),
    );
    const { ref } = await env.control.addItem({ title: "Low stock", class: "docs" });
    for (let pass = 0; pass < 2; pass++) {
      await env.settle();
      await env.control.act(ref, { kind: "item", item: { repo: null, number: 1 } }, "approve", {});
    }
    await env.settle();
    await env.repo.git(
      "merge",
      "--no-ff",
      "--quiet",
      "-m",
      "merge",
      `kozo/${env.store.factoryId}/K-1-t1`,
    );
    await env.repo.commit({ "src/debug.ts": "console.log('left over');\n" }, "debug");
    await env.reconciler.reconcile();
    await env.scheduler.idle();
    await env.settle();
    const [first, second] = [`${ref}/t1`, `${ref}/t2`].map((task) => env.store.state.tasks[task]);
    expect([first?.stage, first?.hold?.kind, second?.hold?.kind, second?.runs]).toEqual([
      "handoff",
      "attention",
      "dependency",
      [],
    ]);
    expect(first?.hold?.reason).toContain("after the merge");
    expect(env.store.state.items[ref]?.stage).not.toBe("triage");

    await env.repo.git("rm", "--quiet", "src/debug.ts");
    await env.repo.git("commit", "--quiet", "-m", "remove the debug file");
    await env.control.act(
      `${ref}/t1`,
      { kind: "task", item: { repo: null, number: 1 }, task: 1 },
      "retry",
      {},
    );
    await env.settle();
    expect(env.store.state.tasks[`${ref}/t1`]?.stage).toBe("complete");
  }, 180_000);

  test("a branch deleted unmerged needs attention, and a human's commit sends the task back to Reviewing", async () => {
    await using env = await factoryOf((request) =>
      request.agent === "triage" ? [{ answer: plan }] : implement(),
    );
    const { task } = await toHandoff(env);
    const worktree = (await env.repo.git("worktree", "list", "--porcelain"))
      .split("\n")
      .find((line) => line.startsWith("worktree ") && line.includes("K-1-t1"))
      ?.slice("worktree ".length);
    if (!worktree) throw new Error("expected the task worktree");
    await Bun.write(join(worktree, "src", "note.ts"), "export const note = 1;\n");
    const human = {
      ...process.env,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_AUTHOR_NAME: "Owner",
      GIT_AUTHOR_EMAIL: "owner@example.com",
      GIT_COMMITTER_NAME: "Owner",
      GIT_COMMITTER_EMAIL: "owner@example.com",
    };
    for (const args of [
      ["add", "--all"],
      ["commit", "--quiet", "-m", "a human touch"],
    ]) {
      expect(await Bun.spawn(["git", ...args], { cwd: worktree, env: human }).exited).toBe(0);
    }
    await env.reconciler.reconcile();
    await env.scheduler.idle();
    expect(env.store.state.tasks[task]?.stage).toBe("reviewing");
    await env.settle();
    expect(env.store.state.tasks[task]?.stage).toBe("handoff");
    await env.reconciler.reconcile();
    await env.scheduler.idle();
    expect(env.store.state.tasks[task]?.stage).toBe("handoff");

    await env.repo.git("worktree", "remove", "--force", worktree);
    await env.repo.git("branch", "-D", `kozo/${env.store.factoryId}/K-1-t1`);
    await env.reconciler.reconcile();
    await env.scheduler.idle();
    expect(env.store.state.tasks[task]?.hold).toMatchObject({
      kind: "attention",
      reason: `kozo/${env.store.factoryId}/K-1-t1 was deleted without a merge`,
    });
  }, 240_000);

  test("a worker that dies makes the run lost, and retry resumes it from the checkpoint", async () => {
    let launches = 0;
    await using env = await factoryOf(
      (request) => (request.agent === "triage" ? [{ answer: plan }] : implement()),
      judgeWith("accept"),
      {
        launcher: (fallback) => ({
          launch(spec, path) {
            launches += 1;
            if (spec.agent !== "implement" || launches > 2) return fallback.launch(spec, path);
            return {
              pid: 4242,
              stop() {},
              messages: (async function* () {
                yield {
                  record: {
                    type: "agent.message",
                    data: { agent: "implement", text: "Starting." },
                  },
                } as const;
              })(),
            };
          },
        }),
      },
    );
    const { ref } = await env.control.addItem({ title: "Low stock", class: "docs" });
    await env.settle();
    await env.control.act(ref, { kind: "item", item: { repo: null, number: 1 } }, "approve", {});
    await env.settle();
    const task = `${ref}/t1`;
    expect(env.store.state.tasks[task]?.hold).toMatchObject({
      kind: "attention",
      reason: "the run lost its worker",
    });
    expect(
      Object.values(env.store.state.runs).find((run) => run.agent === "implement")?.state,
    ).toBe("lost");
    await env.control.act(
      task,
      { kind: "task", item: { repo: null, number: 1 }, task: 1 },
      "retry",
      {},
    );
    await env.settle();
    expect(env.store.state.tasks[task]?.stage).toBe("handoff");
    const implementRuns = Object.values(env.store.state.runs).filter(
      (run) => run.agent === "implement",
    );
    const resumed = env.store.db
      .query<{ node: string }, [string]>(
        "select json_extract(line, '$.node') as node from events where type = 'checkpoint' and run_id = ? order by id limit 1",
      )
      .get(implementRuns.at(-1)?.ref ?? "");
    expect(resumed?.node).toBe("implement");
  }, 180_000);

  test("a run that kozod fails to carry on ends as failed, and retry starts it again", async () => {
    let launches = 0;
    await using env = await factoryOf(
      (request) => (request.agent === "triage" ? [{ answer: plan }] : implement()),
      judgeWith("accept"),
      {
        launcher: (fallback) => ({
          launch(spec, path) {
            launches += 1;
            if (spec.agent === "implement" && launches === 2) throw new Error("no worker");
            return fallback.launch(spec, path);
          },
        }),
      },
    );
    const { ref } = await env.control.addItem({ title: "Low stock", class: "docs" });
    await env.settle();
    await env.control.act(ref, { kind: "item", item: { repo: null, number: 1 } }, "approve", {});
    await env.settle();
    const task = `${ref}/t1`;
    expect(env.store.state.tasks[task]?.hold).toMatchObject({
      kind: "attention",
      reason: "kozod could not run it: no worker",
    });
    expect(
      Object.values(env.store.state.runs).find((run) => run.agent === "implement")?.state,
    ).toBe("failed");
    await env.control.act(
      task,
      { kind: "task", item: { repo: null, number: 1 }, task: 1 },
      "retry",
      {},
    );
    await env.settle();
    expect(env.store.state.tasks[task]?.stage).toBe("handoff");
  }, 180_000);

  test("a review's cost is on the event that ends its run", async () => {
    await using env = await factoryOf((request) =>
      request.agent === "triage" ? [{ answer: plan }] : implement(),
    );
    const { ref } = await env.control.addItem({ title: "Low stock", class: "docs" });
    await env.settle();
    await env.control.act(ref, { kind: "item", item: { repo: null, number: 1 } }, "approve", {});
    await env.settle();
    const review = Object.values(env.store.state.runs).find((run) => run.agent === "review");
    const costs = env.store.db
      .query<{ type: string; usd: number }, [string]>(
        "select type, json_extract(line, '$.cost.usd') as usd from events where run_id = ? and type in ('review.verdict', 'run.changed')",
      )
      .all(review?.ref ?? "");
    expect(costs).toEqual([
      { type: "review.verdict", usd: 0 },
      { type: "run.changed", usd: 0.01 },
    ]);
  }, 120_000);

  test("kozod raises the risk of a plan that reaches a protected path and refuses one over the limits", async () => {
    const withTask = (task: object) => ({
      ...plan,
      plan: { ...plan.plan, risk: "low", tasks: [{ ...plan.plan.tasks[0], ...task }] },
    });
    const answers = [
      withTask({ scope: ["src/**", "db/migrations/**"] }),
      withTask({ scope: ["**"] }),
      withTask({ estimate: { lines: 500, files: 2 } }),
      withTask({ estimate: { lines: 500, files: 2 } }),
    ];
    let triaged = 0;
    await using env = await factoryOf((request) =>
      request.agent === "triage" ? [{ answer: answers[triaged++] }] : [{ hang: true }],
    );
    for (const title of ["Protected", "Everything"]) {
      const { ref } = await env.control.addItem({ title, class: "docs" });
      await env.settle();
      const proposed = env.store.db
        .query<{ risk: string }, [string]>(
          "select json_extract(line, '$.data.plan.risk') as risk from events where type = 'plan.proposed' and item = ?",
        )
        .get(ref);
      expect(proposed?.risk).toBe("high");
      expect(env.store.state.items[ref]?.hold).toMatchObject({ kind: "approval" });
    }
    const { ref } = await env.control.addItem({ title: "Too big", class: "docs" });
    await env.settle();
    expect(env.store.state.items[ref]?.hold).toMatchObject({
      kind: "attention",
      reason:
        "kozod refused the plan draft twice: t1 is estimated at 500 lines in 2 files, over the Charter's 60 lines in 4 files",
    });
    expect(env.agent.requests.at(-1)?.prompt).toContain(
      "REFUSED     kozod refused your previous draft; draft again without these issues:",
    );
  }, 120_000);

  test("a draft that fails the plan checks is drafted once more with the issues", async () => {
    const cyclic = {
      ...plan,
      plan: {
        ...plan.plan,
        tasks: [
          { ...plan.plan.tasks[0], depends_on: ["t2"] },
          { ...plan.plan.tasks[0], id: "t2", scope: ["docs/**"], depends_on: ["t1"] },
        ],
      },
    };
    const answers = [cyclic, plan];
    let triaged = 0;
    await using env = await factoryOf((request) =>
      request.agent === "triage" ? [{ answer: answers[triaged++] }] : [{ hang: true }],
    );
    const { ref } = await env.control.addItem({ title: "Low stock", class: "docs" });
    await env.settle();
    expect(env.agent.requests.map((request) => request.agent)).toEqual(["triage", "triage"]);
    expect(env.agent.requests[1]?.prompt).toContain(
      "- the dependencies form a cycle: t1 -> t2 -> t1",
    );
    expect(Object.values(env.store.state.runs).map((run) => run.state)).toEqual([
      "failed",
      "succeeded",
    ]);
    expect(env.store.state.items[ref]?.stage).not.toBe("triage");
  }, 120_000);

  test("a split plan waits for approval, and a dependent task starts once its dependency is complete", async () => {
    const split = {
      ...plan,
      plan: {
        ...plan.plan,
        tasks: [
          plan.plan.tasks[0],
          {
            ...plan.plan.tasks[0],
            id: "t2",
            goal: "Mention the low-stock notice in the docs",
            done_when: ["The docs mention the low-stock notice"],
            scope: ["docs/**"],
            depends_on: ["t1"],
          },
        ],
      },
    };
    let implemented = 0;
    await using env = await factoryOf((request) => {
      if (request.agent === "triage") return [{ answer: split }];
      implemented += 1;
      return implemented === 1 ? implement() : [{ fail: "the second task stops here" }];
    });
    const { ref } = await env.control.addItem({ title: "Low stock", class: "docs" });
    await env.settle();
    expect(env.store.state.items[ref]).toMatchObject({
      stage: "planning",
      hold: { kind: "approval", reason: "plan approval" },
    });
    await env.control.act(ref, { kind: "item", item: { repo: null, number: 1 } }, "approve", {});
    await env.settle();
    expect(env.store.state.tasks[`${ref}/t1`]?.stage).toBe("handoff");
    expect(env.store.state.tasks[`${ref}/t2`]).toMatchObject({
      stage: "building",
      runs: [],
      hold: { kind: "dependency", reason: `waits for ${ref}/t1 to complete` },
    });
    await env.repo.git(
      "merge",
      "--no-ff",
      "--quiet",
      "-m",
      "merge the low stock notice",
      `kozo/${env.store.factoryId}/K-1-t1`,
    );
    await env.reconciler.reconcile();
    await env.scheduler.idle();
    expect(env.store.state.tasks[`${ref}/t1`]?.stage).toBe("complete");
    expect(env.store.state.items[ref]?.stage).not.toBe("complete");
    expect(env.store.state.tasks[`${ref}/t2`]?.runs.length).toBeGreaterThan(0);
    expect(implemented).toBe(2);
    const merge = env.store.state.tasks[`${ref}/t1`]?.merged?.commit?.slice(0, 12);
    expect(env.agent.requests.at(-1)?.prompt).toContain(
      `Earlier task: ${ref}/t1 ${plan.plan.tasks[0]?.goal}, merged in ${merge}`,
    );
  }, 180_000);

  test("a dependent of a cancelled task is held for attention", async () => {
    const split = {
      ...plan,
      plan: {
        ...plan.plan,
        tasks: [
          plan.plan.tasks[0],
          {
            ...plan.plan.tasks[0],
            id: "t2",
            done_when: ["The docs mention the low-stock notice"],
            scope: ["docs/**"],
            depends_on: ["t1"],
          },
        ],
      },
    };
    await using env = await factoryOf((request) =>
      request.agent === "triage" ? [{ answer: split }] : [{ hang: true }],
    );
    const { ref } = await env.control.addItem({ title: "Low stock", class: "docs" });
    await env.settle();
    await env.control.act(ref, { kind: "item", item: { repo: null, number: 1 } }, "approve", {});
    env.scheduler.tick();
    while (env.agent.requests.length < 2) await Bun.sleep(20);
    await env.control.act(
      `${ref}/t1`,
      { kind: "task", item: { repo: null, number: 1 }, task: 1 },
      "close",
      { cancel: "not needed" },
    );
    await env.settle();
    expect(env.store.state.tasks[`${ref}/t2`]?.hold).toMatchObject({
      kind: "attention",
      reason: `${ref}/t1 was cancelled, so ${ref}/t2 cannot start; close it or plan it again`,
    });
  }, 120_000);

  test("the second rejection of a plan holds the item, and retry drafts it again from Triage", async () => {
    await using env = await factoryOf((request) =>
      request.agent === "triage" || request.agent === "plan"
        ? [{ answer: plan }]
        : [{ hang: true }],
    );
    const item = { kind: "item", item: { repo: null, number: 1 } } as const;
    const { ref } = await env.control.addItem({ title: "Low stock", class: "docs" });
    await env.settle();
    await env.control.act(ref, item, "reject", { reason: "Also cover 0 units" });
    await env.settle();
    expect(
      (await env.control.act(ref, item, "reject", { reason: "Still not 0" })).message,
    ).toContain("a second time");
    await env.settle();
    expect(env.store.state.items[ref]).toMatchObject({
      stage: "planning",
      rejections: 2,
      hold: { kind: "attention" },
    });
    expect(env.agent.requests.map((request) => request.agent)).toEqual(["triage", "plan"]);
    await env.control.act(ref, item, "retry", {});
    await env.settle();
    expect(env.agent.requests.at(-1)?.agent).toBe("triage");
    expect(env.store.state.items[ref]).toMatchObject({
      rejections: 0,
      hold: { kind: "approval", reason: "plan approval" },
    });
  }, 120_000);

  test("a low risk task runs the fast gates without prove, and a diff that changes code raises it", async () => {
    const fastGates = { use: "kozo_gates", input: { level: "fast" } } as const;
    const lowPlan = {
      ...plan,
      plan: {
        ...plan.plan,
        risk: "low",
        tasks: [{ ...plan.plan.tasks[0], scope: ["src/**", "docs/**"] }],
      },
    };
    const docs: FakeStep[] = [
      { write: { "docs/stock.md": "Stock labels say Only N left from 1 to 3 units.\n" } },
      { commit: "docs: describe the low stock label" },
      fastGates,
      { use: "kozo_note", input: { choice: "Documented it", reason: "Docs only" } },
      { answer: { ...report, tests: [] } },
    ];
    // A low task's agent runs the fast gates, whatever the diff turns out to change.
    const code = implement().map((step) => ("tool" in step ? fastGates : step));
    for (const [steps, risk] of [
      [docs, "low"],
      [code, "normal"],
    ] as const) {
      await using env = await factoryOf((request) =>
        request.agent === "triage" ? [{ answer: lowPlan }] : [...steps],
      );
      const { ref } = await env.control.addItem({ title: "Low stock", class: "docs" });
      await env.settle();
      await env.control.act(ref, { kind: "item", item: { repo: null, number: 1 } }, "approve", {});
      await env.settle();
      const task = env.store.state.tasks[`${ref}/t1`];
      expect({ risk, stage: task?.stage, hold: task?.hold }).toEqual({
        risk,
        stage: "handoff",
        hold: null,
      });
      expect(task?.risk).toBe(risk);
      const gates = env.store.db
        .query<{ level: string }, []>(
          "select json_extract(line, '$.data.level') as level from events where type = 'gates.result' order by id limit 1",
        )
        .get();
      expect(gates?.level).toBe(risk === "low" ? "fast" : "full");
      const verifyRuns = Object.values(env.store.state.runs).filter(
        (run) => run.agent === "verify",
      );
      expect(verifyRuns).toHaveLength(risk === "low" ? 0 : 1);
    }
  }, 240_000);

  test("a dependency update runs the deps blueprint: no reproduction and the deep gates", async () => {
    const depsPlan = {
      ...plan,
      plan: {
        ...plan.plan,
        class: "deps",
        approach: "Pin the test runner",
        tasks: [{ ...plan.plan.tasks[0], scope: ["package.json"] }],
      },
    };
    const manifest = `${JSON.stringify(
      {
        name: "suite-shop",
        private: true,
        scripts: { test: "bun test" },
        devDependencies: { "left-pad": "1.3.0" },
      },
      null,
      2,
    )}\n`;
    await using env = await factoryOf((request) =>
      request.agent === "triage"
        ? [{ answer: depsPlan }]
        : [
            { write: { "package.json": manifest } },
            { commit: "chore: pin left-pad" },
            { use: "kozo_gates", input: { level: "deep" } },
            { use: "kozo_note", input: { choice: "Pinned 1.3.0", reason: "The latest" } },
            { answer: { ...report, tests: [] } },
          ],
    );
    const { ref } = await env.control.addItem({ title: "Pin left-pad", class: "deps" });
    await env.settle();
    await env.control.act(ref, { kind: "item", item: { repo: null, number: 1 } }, "approve", {});
    await env.settle();
    expect(env.store.state.tasks[`${ref}/t1`]).toMatchObject({ stage: "handoff", hold: null });
    const gates = env.store.db
      .query<{ level: string }, []>(
        "select json_extract(line, '$.data.level') as level from events where type = 'gates.result' order by id limit 1",
      )
      .get();
    expect(gates?.level).toBe("deep");
    expect(env.agent.requests.at(-1)?.prompt).toContain(
      "This blueprint starts from no failing test",
    );
    expect(env.agent.requests.at(-1)?.prompt).toContain("Call kozo_gates with level deep");
  }, 120_000);

  test("a refactor keeps the behaviour its added tests pin, which prove checks without the change", async () => {
    const refactorPlan = { ...plan, plan: { ...plan.plan, class: "refactor" } };
    const refactored = `export function stockLabel(units: number): string {
  return units === 0 ? "Sold out" : \`\${units} in stock\`;
}
`;
    const pinned = `import { expect, test } from "bun:test";
import { stockLabel } from "./stock.ts";

test("one unit is still counted", () => {
  expect(stockLabel(1)).toBe("1 in stock");
});
`;
    // A run after the first finds the change committed already.
    const steps = (files: Record<string, string | null>, first: boolean): FakeStep[] => [
      ...(first
        ? [{ write: files }, { commit: "refactor: one expression for the stock label" }]
        : []),
      { use: "kozo_gates", input: { level: "full" } },
      { use: "kozo_note", input: { choice: "A ternary", reason: "Two cases" } },
      {
        answer: {
          ...report,
          tests: Object.keys(files).filter((path) => path.endsWith(".test.ts")),
        },
      },
    ];
    const keeps = { "src/stock.ts": refactored, "src/stock-count.test.ts": pinned };
    // The class counts as chosen when the human asked for it; at L3 nobody approves the plan,
    // so a class only the triage session chose leaves prove asking for a failing test.
    for (const [files, requested, expected] of [
      [keeps, "refactor", null],
      [goodChange, "refactor", "KOZO_PROVE: status=fail reason=fails-without-change mode=preserve"],
      [keeps, undefined, "KOZO_PROVE: status=fail reason=passes-without-change tests=1"],
    ] as const) {
      let runs = 0;
      await using env = await factoryOf(
        (request) =>
          request.agent === "triage" ? [{ answer: refactorPlan }] : steps(files, runs++ === 0),
        judgeWith("accept"),
        { charter: (text) => text.replace("default: L1", "default: L3") },
      );
      const { ref } = await env.control.addItem({
        title: "Tidy stockLabel",
        ...(requested ? { class: requested } : {}),
      });
      for (;;) {
        await env.settle();
        if (env.store.state.items[ref]?.hold?.kind !== "approval") break;
        await env.control.act(
          ref,
          { kind: "item", item: { repo: null, number: 1 } },
          "approve",
          {},
        );
      }
      expect(env.store.state.items[ref]?.acceptedBy).toBe("kozod");
      const task = env.store.state.tasks[`${ref}/t1`];
      if (expected === null) {
        expect(task).toMatchObject({ stage: "handoff", hold: null });
        const handoff = await Bun.file(join(env.home.items, ref, "handoff-t1.md")).text();
        expect(handoff).toContain("- prove: the changed tests pass without the change");
      } else {
        expect(task?.hold?.kind).toBe("attention");
        expect(task?.hold?.reason).toContain(expected);
      }
    }
  }, 240_000);

  test("kozod runs a task's codemod before its implement session and commits it as kozo", async () => {
    const codemod = "perl -pi -e 's/units/count/g' src/stock.ts";
    const codemodPlan = {
      ...plan,
      plan: { ...plan.plan, tasks: [{ ...plan.plan.tasks[0], codemod }] },
    };
    await using env = await factoryOf((request) =>
      request.agent === "triage" ? [{ answer: codemodPlan }] : implement(),
    );
    const { ref } = await env.control.addItem({ title: "Low stock" });
    for (;;) {
      await env.settle();
      if (env.store.state.items[ref]?.hold?.kind !== "approval") break;
      await env.control.act(ref, { kind: "item", item: { repo: null, number: 1 } }, "approve", {});
    }
    const task = `${ref}/t1`;
    expect(env.store.state.tasks[task]).toMatchObject({ stage: "handoff", hold: null, codemod });
    expect(env.agent.requests.at(-1)?.prompt).toContain(
      `Before your session kozod runs the codemod \`${codemod}\``,
    );
    const branch = `kozo/${env.store.factoryId}/${ref}-t1`;
    const log = await env.repo.git("log", "--format=%ae %s", `main..${branch}`);
    expect(log.trim().split("\n").at(-1)).toBe(`kozo@localhost.invalid codemod: ${codemod}`);
    const codemodded = await env.repo.git("show", `${branch}~1:src/stock.ts`);
    expect(codemodded).toContain("count");
  }, 120_000);

  test("a task that characterizes may change only test files", async () => {
    const pinned = `import { expect, test } from "bun:test";
import { stockLabel } from "./stock.ts";

test("one unit is still counted", () => {
  expect(stockLabel(1)).toBe("1 in stock");
});
`;
    const characterizePlan = {
      ...plan,
      plan: { ...plan.plan, tasks: [{ ...plan.plan.tasks[0], characterize: true }] },
    };
    for (const [files, expected] of [
      [{ "src/stock-count.test.ts": pinned }, null],
      [
        {
          "src/stock-count.test.ts": pinned,
          // Behaviour kept, so only the characterization check refuses it.
          "src/stock.ts": [
            "export function stockLabel(units: number): string {",
            '  return units === 0 ? "Sold out" : String(units) + " in stock";',
            "}",
            "",
          ].join("\n"),
        },
        "the task characterizes, so its diff changes only test files, but it changes src/stock.ts",
      ],
      // A test, but none that a prove entry runs, so nothing pins the behaviour.
      [
        { "docs/stock-count.test.ts": pinned.replace("./stock.ts", "../src/stock.ts") },
        "the task characterizes, but its diff adds no test that a prove entry of the constraints runs",
      ],
    ] as const) {
      let runs = 0;
      await using env = await factoryOf((request): FakeStep[] =>
        request.agent === "triage"
          ? [{ answer: characterizePlan }]
          : [
              ...(runs++ === 0
                ? [{ write: { ...files } }, { commit: "test: pin the stock label" }]
                : []),
              { use: "kozo_gates", input: { level: "full" } },
              { use: "kozo_note", input: { choice: "One unit", reason: "The edge" } },
              { answer: { ...report, tests: ["src/stock-count.test.ts"] } },
            ],
      );
      const { ref } = await env.control.addItem({ title: "Pin the stock label" });
      for (;;) {
        await env.settle();
        if (env.store.state.items[ref]?.hold?.kind !== "approval") break;
        await env.control.act(
          ref,
          { kind: "item", item: { repo: null, number: 1 } },
          "approve",
          {},
        );
      }
      const task = env.store.state.tasks[`${ref}/t1`];
      if (expected === null) {
        expect(task).toMatchObject({ stage: "handoff", hold: null });
        expect(env.agent.requests.at(-1)?.prompt).toContain("This task characterizes");
      } else {
        expect(task?.hold?.reason).toContain(expected);
      }
    }
  }, 240_000);

  test("a human takes a held task, commits in its worktree and gives it back to the checks", async () => {
    await using env = await factoryOf((request) =>
      request.agent === "triage"
        ? [{ answer: plan }]
        : [
            {
              use: "kozo_blocked",
              input: { reason: "ambiguous", question: "Does 0 say Sold out?" },
            },
            {
              answer: {
                ...report,
                outcome: "blocked",
                blocked: { reason: "ambiguous", question: "Does 0 say Sold out?" },
              },
            },
          ],
    );
    const { ref } = await env.control.addItem({ title: "Low stock", class: "docs" });
    await env.settle();
    await env.control.act(ref, { kind: "item", item: { repo: null, number: 1 } }, "approve", {});
    await env.settle();
    const task = `${ref}/t1`;
    const reference = { kind: "task", item: { repo: null, number: 1 }, task: 1 } as const;
    expect(env.store.state.tasks[task]?.hold?.kind).toBe("question");
    await expect(env.control.act(task, reference, "return", { text: "Done" })).rejects.toThrow(
      "is not taken",
    );

    const taken = await env.control.act(task, reference, "take", {});
    const worktree = worktreePath(env.home, env.repo.path, task);
    expect(taken.message).toStartWith(`${task} is yours: commit in ${worktree} on kozo/`);
    expect(env.store.state.tasks[task]?.hold).toMatchObject({ kind: "taken" });
    await expect(env.control.act(task, reference, "resume", {})).rejects.toThrow(
      "kozo return gives it back",
    );
    for (const [path, text] of Object.entries(goodChange))
      if (text !== null) await Bun.write(join(worktree, path), text);
    await expect(env.control.act(task, reference, "return", { text: "Done" })).rejects.toThrow(
      "has uncommitted changes",
    );
    // The owner commits as themself, without their own signing or hooks.
    const human = [
      "-c",
      "user.name=Owner",
      "-c",
      "user.email=owner@example.com",
      "-c",
      "commit.gpgsign=false",
      "-c",
      "core.hooksPath=/dev/null",
    ];
    await git(worktree, ["add", "--all"]);
    await git(worktree, [...human, "commit", "--quiet", "--message", "feat: only N left"]);
    await git(worktree, ["switch", "--quiet", "-c", "mine"]);
    await expect(env.control.act(task, reference, "return", { text: "Done" })).rejects.toThrow(
      "switch back to it first",
    );
    await git(worktree, ["switch", "--quiet", "-"]);
    await git(worktree, ["merge", "--quiet", "--ff-only", "mine"]);
    const sessions = env.agent.requests.length;
    await env.control.act(task, reference, "return", { text: "Wrote the low-stock branch" });
    expect(env.store.state.tasks[task]?.humanCommits).toBe(true);
    const week = { failures: await weekFailures(env) };
    expect(week.failures).toContainEqual(
      expect.objectContaining({ kind: "human-commit", ref: task, text: "taken and given back" }),
    );
    await env.settle();
    expect(env.store.state.tasks[task]).toMatchObject({
      stage: "handoff",
      hold: null,
      returned: false,
    });
    expect(env.agent.requests).toHaveLength(sessions);
    const returned = env.store.state.tasks[task]?.runs.findLast(
      (run) => env.store.state.runs[run]?.agent === "implement",
    );
    const nodes = env.store.db
      .query<{ node: string }, [string]>(
        "select json_extract(line, '$.node') as node from events where type = 'node.enter' and run_id = ? order by id",
      )
      .all(returned ?? "")
      .map((row) => row.node);
    expect(nodes[0]).toBe("verify-deterministic");
    expect(nodes).not.toContain("implement");
  }, 120_000);

  test("a take during the gates stops them, and the run resumes at its node once given back", async () => {
    // A gate of the fast level only, which a low task's checks run and its agent's full
    // kozo_gates does not.
    const slow = "sleep 47";
    const lowPlan = {
      ...plan,
      plan: {
        ...plan.plan,
        risk: "low",
        tasks: [{ ...plan.plan.tasks[0], scope: ["docs/**"] }],
      },
    };
    const docs: FakeStep[] = [
      { write: { "docs/stock.md": "Stock labels say Only N left from 1 to 3 units.\n" } },
      { commit: "docs: describe the low stock label" },
      { use: "kozo_gates", input: { level: "full" } },
      { use: "kozo_note", input: { choice: "Documented it", reason: "Docs only" } },
      { answer: { ...report, tests: [] } },
    ];
    await using env = await factoryOf(
      (request) => (request.agent === "triage" ? [{ answer: lowPlan }] : docs),
      judgeWith("accept"),
      {
        constraints: (text) =>
          text
            .replace("gates:\n", `gates:\n  slow:\n    run: ${slow}\n`)
            .replace("fast: [lint, test]", "fast: [slow, lint, test]"),
      },
    );
    const running = () => Bun.spawnSync(["pgrep", "-f", slow]).stdout.toString().trim() !== "";
    const { ref } = await env.control.addItem({ title: "Low stock", class: "docs" });
    await env.settle();
    await env.control.act(ref, { kind: "item", item: { repo: null, number: 1 } }, "approve", {});
    env.scheduler.tick();
    for (let waited = 0; !running(); waited += 50) {
      if (waited > 60_000) throw new Error("the slow gate never started");
      await Bun.sleep(50);
    }
    const task = `${ref}/t1`;
    const reference = { kind: "task", item: { repo: null, number: 1 }, task: 1 } as const;
    const stoppedRun = env.store.state.tasks[task]?.runs.at(-1) ?? "";

    await env.control.act(task, reference, "take", {});
    expect(running()).toBe(false);
    expect(env.store.state.runs[stoppedRun]?.state).toBe("stopped");
    expect(env.store.state.tasks[task]?.checkpoint?.node).toBe("verify-deterministic");
    const worktree = worktreePath(env.home, env.repo.path, task);
    expect((await git(worktree, ["status", "--porcelain"])).trim()).toBe("");

    await env.control.act(task, reference, "return", { text: "Looked, changed nothing" });
    env.scheduler.tick();
    for (let waited = 0; !running(); waited += 50) {
      if (waited > 60_000) throw new Error("the slow gate never started again");
      await Bun.sleep(50);
    }
    const resumed = env.store.state.tasks[task]?.runs.at(-1) ?? "";
    expect(resumed).not.toBe(stoppedRun);
    const nodes = env.store.db
      .query<{ node: string }, [string]>(
        "select json_extract(line, '$.node') as node from events where type = 'node.enter' and run_id = ? order by id",
      )
      .all(resumed)
      .map((row) => row.node);
    expect(nodes[0]).toBe("verify-deterministic");
    await env.control.act(task, reference, "close", { cancel: "enough" });
    expect(running()).toBe(false);
    expect(env.store.state.runs[resumed]?.state).toBe("stopped");
  }, 120_000);

  test("kozo say --ask answers from the records in an explorer run and leaves the task as it was", async () => {
    const prompts: string[] = [];
    const accepting = judgeWith("accept");
    const judge: Judge = {
      async judge(request) {
        if (!request.instructions.includes("You answer one question"))
          return accepting.judge(request);
        prompts.push(request.prompt);
        // More than the day's budget, so that the next ask is refused.
        return { output: { answer: "It waits for your merge." }, model: request.model, costUsd: 2 };
      },
    };
    await using env = await factoryOf(
      (request) => (request.agent === "triage" ? [{ answer: plan }] : implement()),
      judge,
      { factory: "budget: { daily_usd: 1 }\n" },
    );
    const { ref } = await env.control.addItem({ title: "Low stock", class: "docs" });
    await env.settle();
    await env.control.act(ref, { kind: "item", item: { repo: null, number: 1 } }, "approve", {});
    await env.settle();
    const task = `${ref}/t1`;
    const reference = { kind: "task", item: { repo: null, number: 1 }, task: 1 } as const;
    const before = structuredClone(env.store.state.tasks[task]);
    const asked = await env.control.act(task, reference, "say", {
      text: "Why is it not merged yet?",
      ask: true,
    });
    expect(asked.message).toBe("It waits for your merge.");
    const [prompt] = prompts;
    expect(prompt).toStartWith("<question>\nWhy is it not merged yet?\n</question>");
    expect(prompt).toContain('<records trust="untrusted">');
    expect(prompt).toContain(`${task} handoff, hold none`);
    expect(prompt).toMatch(/RUN REPORT OF r-\d+/);
    expect(prompt).toContain("src/stock.ts");
    const explorer = Object.values(env.store.state.runs).find((run) => run.agent === "explorer");
    expect(explorer?.state).toBe("succeeded");
    expect({ ...env.store.state.tasks[task], runs: [], updatedAt: "" }).toEqual({
      ...before,
      runs: [],
      updatedAt: "",
    });
    expect(env.store.state.tasks[task]?.runs.at(-1)).toBe(explorer?.ref);

    await expect(
      env.control.act(task, reference, "say", { text: "And now?", ask: true }),
    ).rejects.toThrow("the daily budget of 1 USD is spent");
  }, 120_000);

  test("an automation adds its item once a matching minute, and every approval waits even at L3", async () => {
    await using env = await factoryOf(
      (request) => (request.agent === "triage" ? [{ answer: plan }] : implement()),
      judgeWith("accept"),
      { charter: (text) => text.replace("default: L1", "default: L3") },
    );
    const automation = parseAutomation(
      "nightly",
      '---\nversion: 1\nschedule: "0 3 * * *"\n---\n\n# Low stock\n\nSay only N left.\n',
    );
    const reported: string[] = [];
    const automations = new Automations(
      env.control,
      () => [automation],
      (line) => reported.push(line),
    );
    await automations.run(new Date("2026-10-23T02:59:00"));
    await automations.run(new Date("2026-10-23T03:00:05"));
    await automations.run(new Date("2026-10-23T03:00:40"));
    expect(Object.keys(env.store.state.items)).toEqual(["K-1"]);
    expect(env.store.state.items["K-1"]).toMatchObject({
      source: "automation",
      approvals: "always",
      hold: { kind: "approval", reason: "start approval" },
    });
    await automations.run(new Date("2026-10-24T03:00:00"));
    expect(reported).toEqual([
      "kozod: automation nightly added K-1",
      "kozod: automation nightly added nothing: K-1 still asks for it",
    ]);

    await env.control.act("K-1", { kind: "item", item: { repo: null, number: 1 } }, "approve", {});
    await env.settle();
    expect(env.store.state.items["K-1"]).toMatchObject({
      stage: "planning",
      hold: { kind: "approval", reason: "plan approval" },
    });
  }, 120_000);

  test("work starts in item order, which a human may change", async () => {
    await using env = await factoryOf((request) =>
      request.agent === "triage"
        ? [{ answer: { outcome: "question", question: "Which page?" } }]
        : implement(),
    );
    await env.control.pauseFactory();
    const first = await env.control.addItem({ title: "Low stock" });
    const second = await env.control.addItem({ title: "Sort by price" });
    for (const ref of [first.ref, second.ref]) {
      const number = Number(ref.slice(2));
      await env.control.act(ref, { kind: "item", item: { repo: null, number } }, "approve", {});
    }
    const moved = await env.control.act(
      second.ref,
      { kind: "item", item: { repo: null, number: 2 } },
      "reorder",
      { before: first.ref },
    );
    expect(moved.message).toBe(`moved ${second.ref} before ${first.ref}`);
    expect(env.store.state.order).toEqual([second.ref, first.ref]);
    await env.control.resumeFactory();
    await env.settle();
    const triaged = Object.values(env.store.state.runs)
      .filter((run) => run.agent === "triage")
      .map((run) => run.item);
    expect(triaged).toEqual([second.ref, first.ref]);
  }, 120_000);

  test("a repository that asks for ports gets the same ones in prepare, the gates and the session", async () => {
    await using env = await factoryOf(
      (request) => (request.agent === "triage" ? [{ answer: plan }] : implement()),
      judgeWith("accept"),
      {
        constraints: (text) =>
          text
            .replace("version: 1\n", 'version: 1\nports: 2\nprepare:\n  - test -n "$KOZO_PORT_2"\n')
            .replace(
              "run: sh scripts/lint.sh",
              'run: test -n "$KOZO_PORT_2" && test -n "$KOZO_TASK_ID" && sh scripts/lint.sh',
            ),
      },
    );
    const { ref } = await env.control.addItem({ title: "Low stock", class: "docs" });
    await env.settle();
    await env.control.act(ref, { kind: "item", item: { repo: null, number: 1 } }, "approve", {});
    await env.settle();
    expect(env.store.state.tasks[`${ref}/t1`]).toMatchObject({ stage: "handoff", hold: null });
    const worktree = worktreePath(env.home, env.repo.path, `${ref}/t1`);
    const ports = (await Bun.file(`${worktree}.ports`).json()) as number[];
    expect(ports).toHaveLength(2);
    const run = env.store.state.tasks[`${ref}/t1`]?.runs[0] ?? "";
    const spec = (await Bun.file(join(runFiles(env.home, run).dir, "worker.json")).json()) as {
      gates: { env: Record<string, string> };
    };
    expect(spec.gates.env.KOZO_PORT_2).toBe(String(ports[1]));
  }, 120_000);

  test("kozo say reaches a running run at its next turn", async () => {
    await using env = await factoryOf((request) =>
      request.agent === "triage"
        ? [{ answer: plan }]
        : [{ awaitInstruction: true }, ...implement()],
    );
    const { ref } = await env.control.addItem({ title: "Low stock", class: "docs" });
    await env.settle();
    await env.control.act(ref, { kind: "item", item: { repo: null, number: 1 } }, "approve", {});
    env.scheduler.tick();
    while (env.agent.requests.length < 2) await Bun.sleep(20);
    const task = `${ref}/t1`;
    const said = await env.control.act(
      task,
      { kind: "task", item: { repo: null, number: 1 }, task: 1 },
      "say",
      {
        text: "Keep 0 as Sold out.",
      },
    );
    expect(said.message).toMatch(/^sent to r-\d+, which reads it at its next turn$/);
    await env.settle();
    const delivered = env.store.db
      .query<{ n: number }, []>(
        "select count(*) as n from events where type = 'instruction.delivered'",
      )
      .get();
    expect(delivered?.n).toBe(1);
    expect(env.store.state.items[ref]?.notes).toMatchObject([
      { target: task, kind: "instruction", text: "Keep 0 as Sold out." },
    ]);
    expect(env.store.state.tasks[task]?.stage).toBe("handoff");
  }, 120_000);

  test("a task paused during a node resumes at the next node", async () => {
    await using env = await factoryOf((request) =>
      request.agent === "triage"
        ? [{ answer: plan }]
        : [{ awaitInstruction: true }, ...implement()],
    );
    const { ref } = await env.control.addItem({ title: "Low stock", class: "docs" });
    await env.settle();
    await env.control.act(ref, { kind: "item", item: { repo: null, number: 1 } }, "approve", {});
    env.scheduler.tick();
    while (env.agent.requests.length < 2) await Bun.sleep(20);
    const task = `${ref}/t1`;
    const reference = { kind: "task", item: { repo: null, number: 1 }, task: 1 } as const;
    await env.control.act(task, reference, "pause", {});
    await env.control.act(task, reference, "say", { text: "Keep 0 as Sold out." });
    await env.scheduler.idle();
    expect(env.store.state.tasks[task]?.checkpoint?.node).toBe("verify-deterministic");
    await env.control.act(task, reference, "resume", {});
    await env.settle();
    expect(env.store.state.tasks[task]?.stage).toBe("handoff");
    expect(env.agent.requests).toHaveLength(2);
    const handoff = await Bun.file(join(env.home.items, ref, "handoff-t1.md")).text();
    expect(handoff).toContain(report.summary);
    expect(handoff).toContain("- review: accept");
    expect(handoff).toContain("Kept the label");
  }, 120_000);

  test("three sessions in a row that fail without an answer or on a limit do not pause the factory", async () => {
    for (const kind of ["no-answer", "limit", "crash"] as const) {
      await using env = await factoryOf(() => [{ fail: `failed: ${kind}`, kind }]);
      for (const title of ["First", "Second", "Third"]) {
        await env.control.addItem({ title, class: "docs" });
        await env.settle();
      }
      expect({ kind, paused: env.store.state.paused }).toEqual({ kind, paused: false });
    }
  }, 120_000);

  test("three sessions in a row that fail on the API pause the factory", async () => {
    await using env = await factoryOf(() => [{ fail: "error_during_execution" }]);
    for (const title of ["First", "Second", "Third"]) {
      await env.control.addItem({ title, class: "docs" });
      await env.settle();
    }
    expect(env.store.state).toMatchObject({ paused: true });
    expect(env.store.state.pausedReason).toStartWith("three sessions in a row failed on the API");
  }, 120_000);
});
