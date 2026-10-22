import { describe, expect, test } from "bun:test";
import { mkdir, realpath } from "node:fs/promises";
import { join } from "node:path";
import { kozoHome, runFiles, sha256 } from "@kozo/core";
import {
  type FakeStep,
  fakeAgent,
  gitRepository,
  goodChange,
  suiteBase,
  suiteTask,
  tempDirectory,
  testConfine,
} from "@kozo/testing";
import type { Judge, Verifier } from "@kozo/verify";
import { readDefinition } from "@kozo/verify";
import type { AgentRequest } from "@kozo/worker";
import { ControlPlane } from "./control-plane.ts";
import { EventStore } from "./event-store.ts";
import { inProcessLauncher, type Launcher } from "./launcher.ts";
import { Reconciler } from "./reconcile.ts";
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
  options: {
    charter?: (text: string) => string;
    constraints?: (text: string) => string;
    factory?: string;
    now?: () => Date;
    launcher?: (fallback: Launcher) => Launcher;
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
    verifier: noVerifier,
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

const implement = (): FakeStep[] => [
  { say: "Writing the test first." },
  { write: goodChange },
  { commit: "feat: say only N left when stock is low" },
  { use: "kozo_gates", input: { level: "full" } },
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
    await using env = await factoryOf((request) =>
      request.agent === "triage" ? [{ answer: plan }] : implement(),
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
      target: ref,
      kind: "check",
      text: expect.stringContaining("DONE_WHEN is not met"),
    });
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
