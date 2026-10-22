import { describe, expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { factoryTemplate } from "@kozo/core";
import { gitRepository, tempDirectory } from "@kozo/testing";
import { blueprintFor, builtInFactory, modelFor, readDefinition } from "./factory-definition.ts";

const review = (model?: string) =>
  `---\nname: review\ndescription: Reviews a diff.\n${model ? `model: ${model}\n` : ""}---\n\nReview it.\n`;

describe("readDefinition", () => {
  test("runs on the built-in template without a factory directory", async () => {
    await using dir = await tempDirectory();
    const result = await readDefinition(join(dir.path, "factory"), null);
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
    const result = await readDefinition(join(dir.path, "factory"), null);
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
    const result = await readDefinition(join(dir.path, "factory"), null);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues).toEqual([
      expect.stringContaining("factory.yml: concurrency:"),
      expect.stringContaining("agents/review/agent.md: the document starts with YAML frontmatter"),
    ]);
  });

  test("reads a git repository at the tip of its default branch, never its working tree", async () => {
    await using repo = await gitRepository();
    const commit = await repo.commit({
      "factory.yml": "concurrency: 2\nagents:\n  verify: { model: claude-opus-5-5 }\n",
      "agents/review/agent.md": review("claude-haiku-5-5"),
    });
    await Bun.write(join(repo.path, "factory.yml"), "concurrency: 3\n");
    const result = await readDefinition(repo.path, commit);
    if (!result.ok) throw new Error(result.issues.join("; "));
    const { definition } = result;
    expect(definition.commit).toBe(commit);
    expect(definition.factory.concurrency).toBe(2);
    expect(modelFor(definition, "review")).toBe("claude-haiku-5-5");
    expect(modelFor(definition, "verify")).toBe("claude-opus-5-5");
    expect(modelFor(definition, "implement")).toBe(builtInFactory.agent_defaults.model);
  });

  test("takes each class's blueprint from the definition, kozo's template or bugfix's", async () => {
    await using dir = await tempDirectory({
      "factory/blueprints/refactor.yml": "version: 1\nreproduce: false\nnodes: [claim]\n",
    });
    const refused = await readDefinition(join(dir.path, "factory"), null);
    expect(refused.ok ? [] : refused.issues).toEqual([
      expect.stringContaining("blueprints/refactor.yml: nodes: List the nodes in the order"),
    ]);
    await Bun.write(
      join(dir.path, "factory", "blueprints", "refactor.yml"),
      factoryTemplate["blueprints/bugfix.yml"].replace("reproduce: true", "reproduce: false"),
    );
    const result = await readDefinition(join(dir.path, "factory"), null);
    if (!result.ok) throw new Error(result.issues.join("; "));
    expect(blueprintFor(result.definition, "refactor").reproduce).toBe(false);
    expect(blueprintFor(result.definition, "deps").gates).toBe("deep");
    expect(blueprintFor(result.definition, "feature")).toEqual(result.definition.blueprints.bugfix);
  });
});
