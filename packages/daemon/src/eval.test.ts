import { describe, expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { kozoHome } from "@kozo/core";
import {
  type FakeStep,
  fakeAgent,
  gitRepository,
  judgeWith,
  noVerifier,
  suitePlan as plan,
  suiteBase,
  suiteImplement,
  suiteTask,
  tempDirectory,
  testConfine,
} from "@kozo/testing";
import { readDefinition } from "@kozo/verify";
import type { AgentRequest } from "@kozo/worker";
import { resolveRepository, runEvalCase } from "./eval.ts";
import { inProcessLauncher } from "./launcher.ts";

async function setup(
  script: (request: AgentRequest) => FakeStep[],
  constraints: (text: string) => string = (text) => text,
) {
  const repo = await gitRepository();
  await repo.commit(
    {
      ...suiteBase,
      ".kozo/constraints.yml": constraints(suiteBase[".kozo/constraints.yml"] ?? ""),
    },
    "the suite shop",
  );
  const dir = await tempDirectory();
  const home = kozoHome(join(dir.path, "home"));
  await mkdir(home.factory, { recursive: true });
  await Bun.write(join(home.factory, "factory.yml"), `repositories:\n  - { path: ${repo.path} }\n`);
  const loaded = await readDefinition(home.factory, null);
  if (!loaded.ok) throw new Error(loaded.issues.join("; "));
  const deps = {
    launcher: inProcessLauncher(fakeAgent(script), testConfine),
    judge: judgeWith("accept"),
    verifier: noVerifier,
    confine: testConfine,
  };
  const start = (await repo.git("rev-parse", "HEAD")).trim();
  return {
    repo,
    dir,
    definition: loaded.definition,
    deps,
    start,
    async [Symbol.asyncDispose]() {
      await dir[Symbol.asyncDispose]();
      await repo[Symbol.asyncDispose]();
    },
  };
}

describe("runEvalCase", () => {
  test("plays the owner to Complete, lays the hidden test over the result and runs the checks", async () => {
    await using env = await setup((request) =>
      request.agent === "triage" ? [{ answer: plan }] : suiteImplement(),
    );
    const evals = join(env.dir.path, "evals");
    await Bun.write(join(evals, "low-stock", "hidden.test.ts"), "// the hidden test\n");
    const file = join(evals, "low-stock.yml");
    await Bun.write(
      file,
      [
        "version: 1",
        "id: low-stock",
        `repository: ${env.repo.path}`,
        `start: ${env.start}`,
        "request:",
        "  title: Show when only a few units are left",
        "  body: Say Only N left for 1 to 3 units.",
        "expected:",
        "  outcome: complete",
        "  prepare: 'true'",
        "  hidden:",
        "    files:",
        "      src/hidden.test.ts: low-stock/hidden.test.ts",
        "  checks:",
        "    - test -f src/hidden.test.ts && grep -q 'Only' src/stock.ts",
        "  forbidden:",
        "    - touches .env",
        "",
      ].join("\n"),
    );
    const result = await runEvalCase(file, env.definition, env.deps);
    expect(result).toMatchObject({
      id: "low-stock",
      expected: "complete",
      outcome: "complete",
      passed: true,
      forbidden: ["touches .env"],
    });
    expect(result.checks.map((check) => check.code)).toEqual([0, 0]);
    expect(result.costUsd).toBeGreaterThan(0);
    // The case ran on a clone; the registered repository has no task branch.
    expect(await env.repo.git("branch", "--list", "kozo/*")).toBe("");
  }, 180_000);

  test("stops at the first question, and fails a case that expected Complete", async () => {
    await using env = await setup(() => [
      { answer: { outcome: "question", question: "Which page shows the notice?" } },
    ]);
    const file = join(env.dir.path, "evals", "vague.yml");
    await Bun.write(
      file,
      `version: 1\nid: vague\nrepository: ${env.repo.path}\nstart: ${env.start}\nrequest:\n  title: Improve stock\n  body: Make it better.\nexpected:\n  outcome: complete\n`,
    );
    expect(await runEvalCase(file, env.definition, env.deps)).toMatchObject({
      outcome: "question",
      passed: false,
      checks: [],
    });
    await Bun.write(
      file,
      (await Bun.file(file).text()).replace("outcome: complete", "outcome: question"),
    );
    expect(await runEvalCase(file, env.definition, env.deps)).toMatchObject({ passed: true });
  }, 120_000);

  test("tears down the services in the clone and the task worktree, back at the case's start", async () => {
    const dir = await tempDirectory();
    const marks = join(dir.path, "torn");
    await using env = await setup(
      (request) => (request.agent === "triage" ? [{ answer: plan }] : suiteImplement()),
      (text) =>
        `${text}\nservices:\n  - "true"\nteardown:\n  - "test ! -e src/stock-low.test.ts && pwd >> ${marks}"\n`,
    );
    const file = join(env.dir.path, "evals", "torn.yml");
    await Bun.write(
      file,
      `version: 1\nid: torn\nrepository: ${env.repo.path}\nstart: ${env.start}\nrequest:\n  title: Low stock\n  body: Say Only N left.\nexpected:\n  outcome: complete\n  prepare: "true"\n`,
    );
    const logged: string[] = [];
    expect(
      await runEvalCase(file, env.definition, env.deps, (line) => logged.push(line)),
    ).toMatchObject({ passed: true });
    expect(logged.filter((line) => line.includes("teardown"))).toEqual([]);
    // Both the clone and the task's worktree went back to the start, without the agent's test.
    const torn = (await Bun.file(marks).text()).trim().split("\n");
    expect(torn).toHaveLength(2);
    expect(torn.some((path) => path.includes("K-1-t1"))).toBe(true);
    await dir[Symbol.asyncDispose]();
  }, 180_000);

  test("never runs services on what the eval merged, which nobody read", async () => {
    const readme = "The docs mention the low-stock notice";
    const split = {
      ...plan,
      plan: {
        ...plan.plan,
        done_when: [...suiteTask.doneWhen, readme],
        tasks: [
          plan.plan.tasks[0],
          {
            id: "t2",
            goal: "Mention the low-stock notice in the docs",
            done_when: [readme],
            scope: ["docs/**"],
            depends_on: ["t1"],
            estimate: { lines: 5, files: 1 },
          },
        ],
      },
    };
    await using env = await setup(
      (request) => (request.agent === "triage" ? [{ answer: split }] : suiteImplement()),
      (text) => `${text}\nservices:\n  - "true"\n`,
    );
    const file = join(env.dir.path, "evals", "two.yml");
    await Bun.write(
      file,
      `version: 1\nid: two\nrepository: ${env.repo.path}\nstart: ${env.start}\nrequest:\n  title: Low stock\n  body: Say Only N left, and document it.\nexpected:\n  outcome: complete\n`,
    );
    // The first task starts its services on the case's start; the second, after the merge, may not.
    expect(await runEvalCase(file, env.definition, env.deps)).toMatchObject({
      outcome: "attention",
      passed: false,
      reason: expect.stringContaining("services run only on a worktree at the eval case's start"),
    });
  }, 180_000);

  test("a case on a repository that is not registered is an error", async () => {
    await using env = await setup(() => []);
    expect(resolveRepository(env.definition.factory, "honojs/hono")).toBeNull();
    expect(
      await runEvalCase(join(env.dir.path, "evals", "missing.yml"), env.definition, env.deps),
    ).toMatchObject({ id: "missing", outcome: "error" });
    const file = join(env.dir.path, "evals", "elsewhere.yml");
    await Bun.write(
      file,
      "version: 1\nid: elsewhere\nrepository: honojs/hono\nstart: abc\nrequest:\n  title: x\n  body: y\nexpected:\n  outcome: complete\n",
    );
    expect(await runEvalCase(file, env.definition, env.deps)).toMatchObject({
      outcome: "error",
      error: "honojs/hono is not registered",
    });
  });
});
