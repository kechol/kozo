import { describe, expect, test } from "bun:test";
import { parseBlueprint } from "./blueprint.ts";
import { factoryTemplate } from "./factory-template.ts";

describe("parseBlueprint", () => {
  test("the template's blueprints parse", () => {
    expect(parseBlueprint(factoryTemplate["blueprints/bugfix.yml"])).toMatchObject({
      ok: true,
      value: { reproduce: true },
    });
    expect(parseBlueprint(factoryTemplate["blueprints/deps.yml"])).toMatchObject({
      ok: true,
      value: { reproduce: false, gates: "deep" },
    });
    const docs = parseBlueprint(factoryTemplate["blueprints/docs.yml"]);
    expect(docs).toMatchObject({ ok: true, value: { reproduce: false } });
    expect(docs.ok && docs.value.nodes).not.toContain("verify-app");
    expect(parseBlueprint(factoryTemplate["blueprints/refactor.yml"])).toMatchObject({
      ok: true,
      value: { reproduce: false },
    });
    expect(parseBlueprint(factoryTemplate["blueprints/perf.yml"])).toMatchObject({
      ok: true,
      value: { reproduce: false, gates: "full" },
    });
    expect(parseBlueprint(factoryTemplate["blueprints/migration.yml"])).toMatchObject({
      ok: true,
      value: { reproduce: false, gates: "deep" },
    });
    const feature = parseBlueprint(factoryTemplate["blueprints/feature.yml"]);
    expect(feature).toMatchObject({ ok: true, value: { reproduce: true } });
    expect(feature.ok && feature.value.nodes).toContain("verify-app");
  });

  test("refuses nodes out of order or a required node left out, and allows leaving out verify-app", () => {
    const of = (nodes: string[]) =>
      parseBlueprint(`version: 1\nreproduce: true\nnodes: [${nodes.join(", ")}]\n`).ok;
    const all = [
      "claim",
      "prepare",
      "brief",
      "implement",
      "verify-deterministic",
      "review",
      "verify-app",
      "handoff",
      "final-verify",
    ];
    expect(of(all)).toBe(true);
    expect(of(all.filter((node) => node !== "verify-app"))).toBe(true);
    expect(of(all.filter((node) => node !== "review"))).toBe(false);
    expect(of([...all.slice(1), "claim"])).toBe(false);
  });
});
