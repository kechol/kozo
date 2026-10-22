import { describe, expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { type KozoHome, kozoHome } from "@kozo/core";
import { gitRepository, tempDirectory } from "@kozo/testing";
import {
  DefinitionError,
  modelFor,
  readDefinition,
  refreshDefinition,
  startingDefinition,
} from "./definition.ts";
import { EventStore } from "./event-store.ts";
import { builtInFactory } from "./factory-config.ts";

const review = (model?: string) =>
  `---\nname: review\ndescription: Reviews a diff.\n${model ? `model: ${model}\n` : ""}---\n\nReview it.\n`;

describe("readDefinition", () => {
  test("runs on the built-in template without a factory directory", async () => {
    await using dir = await tempDirectory();
    const result = await readDefinition(kozoHome(dir.path), null);
    if (!result.ok) throw new Error(result.issues.join("; "));
    expect(result.definition.commit).toBeNull();
    expect(result.definition.factory).toEqual(builtInFactory);
    expect(result.definition.agents.plan.name).toBe("plan");
    expect(result.definition.verifyApp.name).toBe("verify-app");
  });

  test("merges factory.yml over the defaults and expands ~", async () => {
    await using dir = await tempDirectory();
    await mkdir(join(dir.path, "factory"));
    await Bun.write(
      join(dir.path, "factory", "factory.yml"),
      "concurrency: 2\nrepositories:\n  - { path: ~/src/shop }\n",
    );
    const result = await readDefinition(kozoHome(dir.path), null);
    if (!result.ok) throw new Error(result.issues.join("; "));
    const { factory } = result.definition;
    expect(factory.concurrency).toBe(2);
    expect(factory.agent_defaults).toEqual(builtInFactory.agent_defaults);
    expect(factory.repositories[0]?.path).toEndWith("/src/shop");
    expect(factory.repositories[0]?.path).not.toStartWith("~");
  });

  test("lists every problem of an invalid definition", async () => {
    await using dir = await tempDirectory();
    await mkdir(join(dir.path, "factory", "agents", "review"), { recursive: true });
    await Bun.write(join(dir.path, "factory", "factory.yml"), "mode: github\nconcurrency: none\n");
    await Bun.write(join(dir.path, "factory", "agents", "review", "agent.md"), "Review it.\n");
    const result = await readDefinition(kozoHome(dir.path), null);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues).toEqual([
      expect.stringContaining("factory.yml: concurrency:"),
      expect.stringContaining("agents/review/agent.md: the document starts with YAML frontmatter"),
    ]);
  });

  test("reads a git repository at the tip of its default branch, never its working tree", async () => {
    await using dir = await tempDirectory();
    await using repo = await gitRepository();
    const home: KozoHome = { ...kozoHome(dir.path), factory: repo.path };
    const commit = await repo.commit({
      "factory.yml": "concurrency: 2\nagents:\n  verify: { model: claude-opus-5-5 }\n",
      "agents/review/agent.md": review("claude-haiku-5-5"),
    });
    await Bun.write(join(repo.path, "factory.yml"), "concurrency: 3\n");
    const result = await readDefinition(home, commit);
    if (!result.ok) throw new Error(result.issues.join("; "));
    const { definition } = result;
    expect(definition.commit).toBe(commit);
    expect(definition.factory.concurrency).toBe(2);
    expect(modelFor(definition, "review")).toBe("claude-haiku-5-5");
    expect(modelFor(definition, "verify")).toBe("claude-opus-5-5");
    expect(modelFor(definition, "implement")).toBe(builtInFactory.agent_defaults.model);
  });
});

describe("applying the definition", () => {
  test("applies a valid commit, refuses an invalid one once and keeps the last applied", async () => {
    await using dir = await tempDirectory();
    await using repo = await gitRepository();
    const home: KozoHome = { ...kozoHome(dir.path), factory: repo.path };
    const store = await EventStore.open(home);
    const types = () =>
      store.db
        .query<{ type: string }, []>(
          "select type from events where type like 'factory.%' and type != 'factory.created' order by id",
        )
        .all()
        .map((row) => row.type);
    const reports: string[] = [];
    const report = (line: string) => reports.push(line);

    const first = await repo.commit({ "factory.yml": "concurrency: 2\n" });
    const inUse = { current: await startingDefinition(home, store) };
    expect(inUse.current.commit).toBe(first);
    expect(types()).toEqual(["factory.applied"]);

    const broken = await repo.commit({ "agents/review/agent.md": "no frontmatter\n" });
    await refreshDefinition(home, store, inUse, report);
    await refreshDefinition(home, store, inUse, report);
    expect(inUse.current.commit).toBe(first);
    expect(types()).toEqual(["factory.applied", "factory.refused"]);
    expect(store.state.definition).toEqual({ applied: first, refused: broken });
    expect(reports).toHaveLength(1);

    // At start, an invalid tip falls back to the last applied commit.
    expect((await startingDefinition(home, store)).commit).toBe(first);

    const fixed = await repo.commit({ "agents/review/agent.md": review() });
    await refreshDefinition(home, store, inUse, report);
    expect(inUse.current.commit).toBe(fixed);
    expect(inUse.current.factory.concurrency).toBe(2);
    expect(store.state.definition).toEqual({ applied: fixed, refused: null });
    store.close();
  });

  test("refuses to start on an invalid definition that was never applied", async () => {
    await using dir = await tempDirectory();
    await using repo = await gitRepository();
    const home: KozoHome = { ...kozoHome(dir.path), factory: repo.path };
    const store = await EventStore.open(home);
    await repo.commit({ "factory.yml": "concurrency: none\n" });
    await expect(startingDefinition(home, store)).rejects.toThrow(DefinitionError);
    store.close();
  });
});
