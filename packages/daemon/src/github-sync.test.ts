import { describe, expect, test } from "bun:test";
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
  const sync = new GitHubSync(store, definition, control, github);
  return {
    home,
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

  test("kozo:accept approves a start, and the labels follow the item", async () => {
    await using env = await setup();
    await env.sync.register();
    const number = env.github.addIssue("me/shop", { title: "Sort", author: "reader" });
    await env.sync.poll();
    expect(env.labels(number)?.sort()).toEqual(["kozo:intake", "kozo:needs-approval"]);
    expect(env.github.calls.filter((call) => call.startsWith("createLabel"))).toHaveLength(12);

    env.github.repositories.get("me/shop")?.issues[0]?.labels.push("kozo:accept");
    await env.sync.poll();
    expect(env.store.state.items[`shop#${number}`]).toMatchObject({ stage: "triage", hold: null });
    await env.sync.poll();
    expect(env.labels(number)?.sort()).toEqual(["kozo:accept", "kozo:triage"]);
    expect(env.github.calls.filter((call) => call.startsWith("createLabel"))).toHaveLength(12);
  });
});
