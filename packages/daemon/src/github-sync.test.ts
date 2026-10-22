import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { kozoHome } from "@kozo/core";
import { exampleCharter, fakeGitHub, gitRepository, tempDirectory } from "@kozo/testing";
import { readDefinition } from "@kozo/verify";
import { ControlPlane } from "./control-plane.ts";
import { EventStore } from "./event-store.ts";
import { GitHubSync } from "./github-sync.ts";
import { readItemFile } from "./item-file.ts";

async function setup() {
  const repo = await gitRepository();
  await repo.commit(
    { ".kozo/charter.yml": exampleCharter.replace("default: L1", "default: L2") },
    "start",
  );
  const dir = await tempDirectory();
  const home = kozoHome(dir.path);
  const loaded = await readDefinition(home.factory, null);
  if (!loaded.ok) throw new Error(loaded.issues.join("; "));
  const definition = {
    current: {
      ...loaded.definition,
      factory: {
        ...loaded.definition.factory,
        mode: "github" as const,
        repositories: [{ path: repo.path, github: "me/shop" }],
      },
    },
  };
  const store = await EventStore.open(home);
  const control = new ControlPlane(home, store, definition);
  const github = fakeGitHub();
  const sync = new GitHubSync(home, store, definition, control, github);
  return {
    home,
    repo: repo.path,
    store,
    github,
    sync,
    labels: (number: number) =>
      github.repositories.get("me/shop")?.issues.find((issue) => issue.number === number)?.labels,
    async [Symbol.asyncDispose]() {
      store.close();
      await dir[Symbol.asyncDispose]();
      await repo[Symbol.asyncDispose]();
    },
  };
}

describe("GitHubSync", () => {
  test("trusts only a writer's Issue opened after registration, and skips bots", async () => {
    await using env = await setup();
    const before = new Date(Date.now() - 60_000).toISOString();
    await env.sync.register();
    await env.sync.register();
    expect(Object.keys(env.store.state.repositories)).toEqual(["me/shop"]);
    env.github.permissions.set("me/shop owner", "admin");
    env.github.permissions.set("me/shop reader", "read");
    const trusted = env.github.addIssue("me/shop", {
      title: "Low stock",
      body: "Say only N left.",
    });
    const reader = env.github.addIssue("me/shop", { title: "Sort", author: "reader" });
    const old = env.github.addIssue("me/shop", { title: "Old", createdAt: before });
    env.github.addIssue("me/shop", { title: "Bump", author: "dependabot[bot]" });

    await env.sync.poll();
    const { items } = env.store.state;
    expect(Object.keys(items)).toEqual([`shop#${trusted}`, `shop#${reader}`, `shop#${old}`]);
    expect(items[`shop#${trusted}`]).toMatchObject({ stage: "triage", hold: null });
    expect(items[`shop#${reader}`]?.hold?.reason).toBe("start approval");
    expect(items[`shop#${old}`]?.hold?.reason).toBe("start approval");
    expect(await readItemFile(env.home, `shop#${trusted}`)).toMatchObject({
      title: "Low stock",
      body: "Say only N left.",
    });
  });

  test("kozo:accept from a writer approves a start, and the labels follow the item", async () => {
    await using env = await setup();
    await env.sync.register();
    const number = env.github.addIssue("me/shop", { title: "Sort", author: "reader" });
    await env.sync.poll();
    expect(env.labels(number)?.sort()).toEqual(["kozo:intake", "kozo:needs-approval"]);
    expect(env.github.calls.filter((call) => call.startsWith("createLabel"))).toHaveLength(12);

    env.github.repositories.get("me/shop")?.issues[0]?.labels.push("kozo:accept");
    env.github.labellers.set(`me/shop #${number} kozo:accept`, "triager");
    env.github.permissions.set("me/shop triager", "triage");
    await env.sync.poll();
    expect(env.store.state.items[`shop#${number}`]?.hold?.reason).toBe("start approval");
    env.github.labellers.set(`me/shop #${number} kozo:accept`, "owner");
    env.github.permissions.set("me/shop owner", "maintain");
    await env.sync.poll();
    expect(env.store.state.items[`shop#${number}`]).toMatchObject({ stage: "triage", hold: null });
    await env.sync.poll();
    expect(env.labels(number)?.sort()).toEqual(["kozo:accept", "kozo:triage"]);
    expect(env.github.calls.filter((call) => call.startsWith("createLabel"))).toHaveLength(12);
  });

  test("keeps one status comment, posts each question once and hands off a task as a pull request", async () => {
    await using env = await setup();
    await env.sync.register();
    env.github.permissions.set("me/shop owner", "admin");
    const number = env.github.addIssue("me/shop", { title: "Low stock" });
    await env.sync.poll();
    const ref = `shop#${number}`;
    const comments = () =>
      env.github.repositories.get("me/shop")?.issues[0]?.comments.map((comment) => comment.body) ??
      [];
    expect(comments()).toEqual([
      `**kozo**: ${ref} is in triage.\n\nCost so far: 0.00 USD\n\n<!-- kozo:status:${ref} -->`,
    ]);

    await env.store.append({
      type: "hold.set",
      item: ref,
      data: { target: "item", hold: "question", by: "kozod", reason: "Ask @owner: fixes #3?" },
    });
    await env.sync.poll();
    await env.sync.poll();
    expect(comments()).toHaveLength(2);
    expect(comments()[0]).toContain("waits for question: Ask @\u200bowner: f\u200bixes #3?");
    expect(comments()[1]).toStartWith(`**Question about ${ref}:** Ask @\u200bowner`);

    await env.store.append({
      type: "hold.cleared",
      item: ref,
      data: { target: "item", hold: "question", by: "human" },
    });
    const task = `${ref}/t1`;
    await env.store.append({
      type: "plan.accepted",
      item: ref,
      data: {
        by: "kozod",
        plan: {
          version: 1,
          item: ref,
          class: "bugfix",
          risk: "normal",
          approach: "Change the label",
          done_when: ["The label says Only N left"],
          tasks: [
            {
              id: "t1",
              goal: "Say only N left",
              done_when: ["The label says Only N left"],
              scope: ["src/**"],
              depends_on: [],
              estimate: { lines: 20, files: 2 },
            },
          ],
        },
      },
    });
    for (const [from, to] of [
      ["building", "reviewing"],
      ["reviewing", "handoff"],
    ] as const) {
      await env.store.append({
        type: "stage.changed",
        item: ref,
        task,
        data: { target: "task", from, to, by: "kozod", reason: "checks passed" },
      });
    }
    await Bun.write(join(env.home.root, "items", ref, "handoff-t1.md"), "# Report\n\nCloses #9.\n");
    await env.store.append({
      type: "handoff.ready",
      item: ref,
      task,
      data: {
        branch: `kozo/${env.store.factoryId}/${number}-t1`,
        head: "a".repeat(40),
        report: `items/${ref}/handoff-t1.md`,
      },
    });
    await env.sync.poll();
    await env.sync.poll();
    expect(env.github.calls.filter((call) => /^(push|createPull|updatePull) /.test(call))).toEqual([
      `push ${env.repo} kozo/${env.store.factoryId}/${number}-t1`,
      `createPull me/shop kozo/${env.store.factoryId}/${number}-t1`,
    ]);
    const pull = env.github.repositories.get("me/shop")?.pulls[0];
    expect(env.github.bodies.get(pull?.number ?? 0)).toBe(
      `# Report\n\nC\u200bloses #9.\n\n\nPart of #${number}`,
    );
    expect(comments().at(-1)).toStartWith(
      `${task} is ready for you to review and merge: ${pull?.url}`,
    );
    expect(comments()[0]).toContain(`| ${task} | handoff | ${pull?.url} |`);
  });
});
