import { describe, expect, test } from "bun:test";
import { parseConstraints } from "./constraints.ts";

const sampleShop = `
version: 1
prepare:
  - pnpm install --frozen-lockfile
  - pnpm db:up
gates:
  typecheck:
    run: pnpm typecheck
  lint:
    run: pnpm lint
  unit:
    run: pnpm test:unit
  integration:
    run: pnpm test:integration
  build:
    run: pnpm build
  e2e:
    run: pnpm test:e2e
levels:
  fast: [typecheck, lint, unit]
  full: [typecheck, lint, unit, integration, build]
  deep: [typecheck, lint, unit, integration, build, e2e]
`;

function issuesOf(text: string) {
  const result = parseConstraints(text);
  if (result.ok) throw new Error("expected the constraints to be rejected");
  return result.issues;
}

describe("parseConstraints", () => {
  test("parses the kozo-sample-shop constraints", () => {
    const result = parseConstraints(sampleShop);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.prepare).toEqual(["pnpm install --frozen-lockfile", "pnpm db:up"]);
    expect(result.value.gates.e2e).toEqual({ run: "pnpm test:e2e" });
    expect(result.value.levels.full).toEqual(["typecheck", "lint", "unit", "integration", "build"]);
  });

  test("prepare and levels may be left out", () => {
    const result = parseConstraints(
      "version: 1\ngates:\n  lint:\n    run: bun run check\nlevels:\n  fast: [lint]\n",
    );
    expect(result).toEqual({
      ok: true,
      value: {
        version: 1,
        prepare: [],
        gates: { lint: { run: "bun run check" } },
        levels: { fast: ["lint"] },
      },
    });
  });

  test("a level that names an undefined gate is an issue at its entry", () => {
    expect(issuesOf(sampleShop.replace("build, e2e]", "build, e2e, a11y]"))).toEqual([
      'levels.deep.6: Gate "a11y" is not defined in gates',
    ]);
  });

  test("a gate without a command is an issue", () => {
    expect(
      issuesOf(sampleShop.replace("    run: pnpm lint\n", "    command: pnpm lint\n")),
    ).toEqual([
      "gates.lint.run: Invalid input: expected string, received undefined",
      'gates.lint: Unrecognized key: "command"',
    ]);
  });

  test("an unknown level is an issue", () => {
    expect(issuesOf(sampleShop.replace("  fast: [", "  quick: ["))[0]).toStartWith("levels:");
  });

  test("an empty level or a repeated gate is an issue", () => {
    expect(
      issuesOf(sampleShop.replace("fast: [typecheck, lint, unit]", "fast: []"))[0],
    ).toStartWith("levels.fast:");
    expect(
      issuesOf(sampleShop.replace("fast: [typecheck, lint, unit]", "fast: [lint, lint]")),
    ).toEqual(["levels.fast: List each gate once"]);
  });

  test("a gate name outside the KOZO_GATES alphabet is an issue", () => {
    expect(issuesOf(sampleShop.replace("  lint:\n", "  Lint,all:\n"))[0]).toStartWith(
      "gates.Lint,all:",
    );
  });

  test("an unknown version is an issue", () => {
    expect(issuesOf(sampleShop.replace("version: 1", "version: 2"))[0]).toStartWith("version:");
  });

  test("a YAML syntax error is an issue on the document", () => {
    expect(issuesOf("gates: {lint: \n")[0]).toStartWith("<document>: ");
  });
});
