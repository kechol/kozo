import { describe, expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { kozoHome } from "@kozo/core";
import {
  type FakeStep,
  fakeAgent,
  fakeGitHub,
  gitRepository,
  goodChange,
  suiteBase,
  suiteTask,
  tempDirectory,
  testConfine,
} from "@kozo/testing";
import { type Judge, readDefinition, type Verifier } from "@kozo/verify";
import { ControlPlane } from "./control-plane.ts";
import { EventStore } from "./event-store.ts";
import { GitHubSync } from "./github-sync.ts";
import { inProcessLauncher } from "./launcher.ts";
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

// In GitHub mode the agent's gates take origin's default branch as their base.
const implement: FakeStep[] = [
  { write: goodChange },
  { commit: "feat: say only N left when stock is low" },
  {
    tool: "Bash",
    input: { command: "kozo gates --level full --base refs/remotes/origin/main" },
    output: { stdout: "KOZO_GATES: level=full status=pass gates=lint,test duration=1s" },
  },
  { use: "kozo_note", input: { choice: "Kept the label in one function", reason: "One place" } },
  {
    answer: {
      version: 1,
      outcome: "done",
      summary: "stockLabel says Only N left for 1 to 3 units.",
      changes: ["Added the low-stock branch to stockLabel"],
      out_of_scope: [],
      tests: ["src/stock-low.test.ts"],
    },
  },
];

const accept: Judge = {
  async judge(request) {
    return {
      output: { verdict: "accept", summary: "accept: the label", findings: [] },
      model: request.model,
      costUsd: 0.01,
    };
  },
};

const noVerifier: Verifier = {
  async verify() {
    throw new Error("verify-app is missing, so verify never runs");
  },
};

describe("GitHub mode", () => {
  test("an Issue becomes a merged pull request, and its Issue is closed once DONE_WHEN holds", async () => {
    await using repo = await gitRepository();
    await repo.commit(
      {
        ...suiteBase,
        ".kozo/charter.yml": (suiteBase[".kozo/charter.yml"] ?? "").replace(
          "default: L1",
          "default: L2",
        ),
      },
      "the suite shop",
    );
    await repo.git("update-ref", "refs/remotes/origin/main", "HEAD");
    await using dir = await tempDirectory();
    const home = kozoHome(dir.path);
    await mkdir(home.factory, { recursive: true });
    await Bun.write(
      join(home.factory, "factory.yml"),
      `mode: github\nrepositories:\n  - { path: ${repo.path}, github: me/shop }\n`,
    );
    const loaded = await readDefinition(home.factory, null);
    if (!loaded.ok) throw new Error(loaded.issues.join("; "));
    const definition = { current: loaded.definition };
    const store = await EventStore.open(home);
    const runner = new Runner(home, store, {
      launcher: inProcessLauncher(
        fakeAgent((request) => (request.agent === "triage" ? [{ answer: plan }] : implement)),
      ),
      judge: accept,
      verifier: noVerifier,
      kozoCommand: "kozo",
      definition,
      confine: testConfine,
    });
    const control = new ControlPlane(home, store, definition, runner);
    const scheduler = new Scheduler(store, runner, definition);
    const reconciler = new Reconciler(
      store,
      runner,
      () => {},
      (ref, work) => scheduler.startWork(ref, work),
      () => definition.current.factory.mode,
    );
    const github = fakeGitHub();
    const sync = new GitHubSync(home, store, definition, control, github);
    const settle = async () => {
      scheduler.tick();
      await scheduler.idle();
    };
    try {
      await sync.register();
      github.permissions.set("me/shop owner", "admin");
      const number = github.addIssue("me/shop", {
        title: "Show when only a few units are left",
        createdAt: new Date(Date.now() + 60_000).toISOString(),
      });
      const ref = `shop#${number}`;
      const task = `${ref}/t1`;

      await sync.poll();
      await settle();
      expect(store.state.items[ref]).toMatchObject({
        stage: "planning",
        hold: { kind: "approval", reason: "plan approval" },
      });
      await control.act(ref, { kind: "item", item: { repo: "shop", number } }, "approve", {});
      await settle();
      expect(store.state.tasks[task]?.stage).toBe("handoff");

      await sync.poll();
      const branch = `kozo/${store.factoryId}/${number}-t1`;
      const pull = github.repositories.get("me/shop")?.pulls[0];
      expect(pull).toMatchObject({ head: branch, state: "open" });
      expect(github.bodies.get(pull?.number ?? 0)).toEndWith(`Part of #${number}`);

      // A human merges the pull request on GitHub, and kozod's next fetch brings it in.
      const head = (await repo.git("rev-parse", branch)).trim();
      const merge = (
        await repo.git(
          "commit-tree",
          `${head}^{tree}`,
          "-p",
          "refs/remotes/origin/main",
          "-p",
          head,
          "-m",
          `Merge pull request #${pull?.number}`,
        )
      ).trim();
      await repo.git("update-ref", "refs/remotes/origin/main", merge);
      if (pull) Object.assign(pull, { state: "merged", mergeCommit: merge });
      await reconciler.reconcile();
      await scheduler.idle();
      expect(store.state.tasks[task]).toMatchObject({
        stage: "complete",
        merged: { commit: merge },
      });
      expect(store.state.items[ref]?.stage).toBe("complete");

      await sync.poll();
      expect(github.repositories.get("me/shop")?.issues[0]).toMatchObject({
        state: "closed",
        stateReason: "completed",
      });
      expect((await repo.git("rev-parse", "main")).trim()).not.toBe(merge);
    } finally {
      await scheduler.idle();
      store.close();
    }
  }, 240_000);
});
