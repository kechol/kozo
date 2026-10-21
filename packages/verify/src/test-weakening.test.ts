import { describe, expect, test } from "bun:test";
import { changedGateScripts, findTestWeakening } from "./test-weakening.ts";
import { parseChangedLines } from "./unified-diff.ts";

const added = (...texts: string[]) => texts.map((text, index) => ({ line: index + 1, text }));

function markersIn(...texts: string[]) {
  return findTestWeakening([
    { path: "a.test.ts", lines: { added: added(...texts), removed: [] }, change: "added" },
  ]).map((found) => (found.kind === "disabled-test" ? found.marker : found.kind));
}

describe("findTestWeakening", () => {
  test("finds markers that disable or focus tests", () => {
    expect(
      markersIn(
        "it.skip('a', () => {})",
        "describe.only('b', () => {})",
        "test.todo('c')",
        "test.fixme('d', async () => {})",
        "it.fails('e', () => {})",
        "test.skipIf(process.env.CI)('f', () => {})",
        "describe.concurrent.skip('g', () => {})",
        "xit('h', () => {})",
        "  this.skip();",
        "@pytest.mark.skip(reason='x')",
        '\tt.Skip("later")',
        "#[ignore]",
      ),
    ).toEqual([
      "skip",
      "only",
      "todo",
      "fixme",
      "expected failure",
      "conditional run",
      "skip",
      "x or f prefix",
      "skip call",
      "pytest mark",
      "go skip",
      "rust ignore",
    ]);
  });

  test("ignores ordinary tests, comments and look-alike calls", () => {
    expect(
      markersIn(
        "it('skips nothing', () => {})",
        "// it.skip('commented out')",
        "model.fit(data)",
        "const profit = compute()",
        "expect(list.skip(2)).toEqual([3])",
      ),
    ).toEqual([]);
  });

  test("reports the line number of a marker", () => {
    const lines = parseChangedLines(
      [
        "diff --git a/a.test.ts b/a.test.ts",
        "--- a/a.test.ts",
        "+++ b/a.test.ts",
        "@@ -10,0 +11,2 @@ describe('cart', () => {",
        "+  it('adds', () => {});",
        "+  it.only('removes', () => {});",
      ].join("\n"),
    );
    expect(findTestWeakening([{ path: "a.test.ts", lines: lines, change: "modified" }])).toEqual([
      { kind: "disabled-test", path: "a.test.ts", line: 12, marker: "only" },
    ]);
  });

  test("a test file that loses assertions is weakened", () => {
    const found = findTestWeakening([
      {
        path: "a.test.ts",
        lines: {
          added: [],
          removed: ["  expect(total).toBe(3);", "  expect(items).toHaveLength(2);"],
        },
        change: "modified",
      },
    ]);
    expect(found).toEqual([
      { kind: "weakened-test", path: "a.test.ts", reason: "2 assertions removed, 0 added" },
    ]);
  });

  test("a strict matcher traded for a weak one is weakened", () => {
    const found = findTestWeakening([
      {
        path: "a.test.ts",
        lines: {
          added: added("  expect(total).toBeTruthy();"),
          removed: ["  expect(total).toBe(3);"],
        },
        change: "modified",
      },
    ]);
    expect(found).toEqual([
      { kind: "weakened-test", path: "a.test.ts", reason: "strict matchers replaced by weak ones" },
    ]);
  });

  test("an assertion moved under a new condition is weakened", () => {
    const found = findTestWeakening([
      {
        path: "a.test.ts",
        lines: {
          added: added("  if (total !== undefined) {", "    expect(total).toBe(3);", "  }"),
          removed: ["  expect(total).toBe(3);"],
        },
        change: "modified",
      },
    ]);
    expect(found).toEqual([
      { kind: "weakened-test", path: "a.test.ts", reason: "assertions moved under a condition" },
    ]);
  });

  test("an assertion moved out of a block is not put under a condition", () => {
    const found = findTestWeakening([
      {
        path: "a.test.ts",
        lines: {
          added: added("  expect(total).toBe(3);", "  if (!ready) throw pending;"),
          removed: ["    expect(total).toBe(3);"],
        },
        change: "modified",
      },
    ]);
    expect(found).toEqual([]);
  });

  test("a changed expectation that stays strict is not weakened", () => {
    const found = findTestWeakening([
      {
        path: "a.test.ts",
        lines: { added: added("  expect(total).toBe(4);"), removed: ["  expect(total).toBe(3);"] },
        change: "modified",
      },
    ]);
    expect(found).toEqual([]);
  });

  test("a renamed test file is neither weakened nor newly disabled", () => {
    const body = [
      "it.skip('later', () => {});",
      "  if (ready) {",
      "    expect(total).toBe(3);",
      "  }",
    ];
    const found = findTestWeakening([
      { path: "old.test.ts", change: "deleted", lines: { added: [], removed: body } },
      { path: "new.test.ts", change: "added", lines: { added: added(...body), removed: [] } },
    ]);
    expect(found).toEqual([]);
  });

  test("an assertion dropped while moving a file is still weakening", () => {
    const found = findTestWeakening([
      {
        path: "old.test.ts",
        lines: { added: [], removed: ["  expect(a).toBe(1);", "  expect(b).toBe(2);"] },
        change: "deleted",
      },
      {
        path: "new.test.ts",
        lines: { added: added("  expect(a).toBe(1);"), removed: [] },
        change: "added",
      },
    ]);
    expect(found).toEqual([
      { kind: "weakened-test", path: "old.test.ts", reason: "1 assertions removed, 0 added" },
    ]);
  });

  test("code after a short block comment is still checked", () => {
    expect(markersIn("/* later */ it.skip('a', () => {})", "/* a */ it.only('b') /* c */")).toEqual(
      ["skip", "only"],
    );
    expect(markersIn("/* it.skip('a') */", " * it.skip('in a doc comment')", "# it.skip")).toEqual(
      [],
    );
  });

  test("an assertion taken out of an existing file cannot be laundered through a new one", () => {
    const found = findTestWeakening([
      {
        path: "cart.test.ts",
        change: "modified",
        lines: {
          added: added("  expect(total).toBeTruthy();"),
          removed: ["  expect(total).toBe(3);"],
        },
      },
      {
        path: "unused.test.ts",
        change: "added",
        lines: { added: added("  expect(total).toBe(3);"), removed: [] },
      },
    ]);
    expect(found).toEqual([
      {
        kind: "weakened-test",
        path: "cart.test.ts",
        reason: "strict matchers replaced by weak ones",
      },
    ]);
  });

  test("a file moved under a new condition is checked like the file it replaced", () => {
    const found = findTestWeakening([
      {
        path: "old.test.ts",
        change: "deleted",
        lines: { added: [], removed: ["  expect(a).toBe(1);"] },
      },
      {
        path: "new.test.ts",
        change: "added",
        lines: { added: added("  if (false) {", "    expect(a).toBe(1);", "  }"), removed: [] },
      },
    ]);
    expect(found).toEqual([
      { kind: "weakened-test", path: "new.test.ts", reason: "assertions moved under a condition" },
    ]);
  });

  test("an early return added to an existing test is weakening", () => {
    const found = findTestWeakening([
      {
        path: "a.test.ts",
        change: "modified",
        lines: { added: added("  if (process.env.CI) return;", "  const total = 3;"), removed: [] },
      },
    ]);
    expect(found).toEqual([
      { kind: "weakened-test", path: "a.test.ts", reason: "an early return was added" },
    ]);
  });

  test("a new test file is only checked for markers", () => {
    const found = findTestWeakening([
      {
        path: "a.test.ts",
        lines: { added: added("  expect(total).toBeTruthy();"), removed: [] },
        change: "added",
      },
    ]);
    expect(found).toEqual([]);
  });
});

describe("changedGateScripts", () => {
  const base = {
    test: "pnpm test:unit && pnpm test:e2e",
    "test:unit": "vitest run",
    "test:e2e": "playwright test",
    lint: "biome check .",
    dev: "next dev",
  };

  test("a script that a gate runs through another script is covered", () => {
    expect(
      changedGateScripts(["pnpm test"], base, { ...base, "test:e2e": "echo skipped" }),
    ).toEqual(["test:e2e"]);
  });

  test("an added pre hook or a removed script is a change", () => {
    const { lint: _, ...withoutLint } = base;
    expect(
      changedGateScripts(["pnpm lint", "npm run test:unit"], base, {
        ...withoutLint,
        "pretest:unit": "rm -rf src/__tests__",
      }),
    ).toEqual(["lint", "pretest:unit"]);
  });

  test("scripts that no gate runs may change", () => {
    expect(changedGateScripts(["pnpm lint"], base, { ...base, dev: "next dev --turbo" })).toEqual(
      [],
    );
  });
});
