import { describe, expect, test } from "bun:test";
import {
  changedGateScripts,
  findTestWeakening,
  gateFiles,
  includedFiles,
  reachedScripts,
} from "./test-weakening.ts";
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
    expect(markersIn(" * x */ it.skip('after a closing comment')")).toEqual(["skip"]);
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
      {
        path: "b.test.ts",
        change: "modified",
        lines: { added: added("  return undefined;", "  return void 0;"), removed: [] },
      },
      {
        path: "c.test.ts",
        change: "modified",
        lines: { added: added("  return items.map(toLine);"), removed: [] },
      },
    ]);
    expect(found).toEqual([
      { kind: "weakened-test", path: "a.test.ts", reason: "an early return was added" },
      { kind: "weakened-test", path: "b.test.ts", reason: "an early return was added" },
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

describe("findTestWeakening in other languages", () => {
  const modified = (path: string, removed: string[], addedTexts: string[]) =>
    findTestWeakening([
      { path, change: "modified", lines: { removed, added: added(...addedTexts) } },
    ]).map((found) => (found.kind === "weakened-test" ? found.reason : found.marker));

  test("removing an assertion counts in pytest, unittest, Go and Rust", () => {
    expect(modified("test_cart.py", ["    assert total(cart) == 600"], [])).toEqual([
      "1 assertions removed, 0 added",
    ]);
    expect(modified("test_cart.py", ["        self.assertEqual(total(cart), 600)"], [])).toEqual([
      "1 assertions removed, 0 added",
    ]);
    expect(modified("cart_test.go", ['		t.Errorf("total = %d", got)'], [])).toEqual([
      "1 assertions removed, 0 added",
    ]);
    expect(modified("cart_test.go", ["	require.Equal(t, 600, got)"], [])).toEqual([
      "1 assertions removed, 0 added",
    ]);
    expect(modified("cart.rs", ["    assert_eq!(total(&cart), 600);"], [])).toEqual([
      "1 assertions removed, 0 added",
    ]);
  });

  test("an equality replaced by a truthiness or not-null check is a weakened test", () => {
    const weakened = "strict matchers replaced by weak ones";
    expect(
      modified(
        "cart.test.ts",
        ["  expect(label).toBe('Sold out');"],
        ["  expect(label).not.toBeNull();"],
      ),
    ).toEqual([weakened]);
    expect(
      modified("test_cart.py", ["    assert total(cart) == 600"], ["    assert total(cart)"]),
    ).toEqual([weakened]);
    expect(
      modified(
        "test_cart.py",
        ["        self.assertEqual(total(cart), 600)"],
        ["        self.assertTrue(total(cart))"],
      ),
    ).toEqual([weakened]);
    expect(
      modified("cart_test.go", ["	assert.Equal(t, 600, got)"], ["	assert.NotNil(t, got)"]),
    ).toEqual([weakened]);
    expect(
      modified(
        "cart.rs",
        ["    assert_eq!(total(&cart), 600);"],
        ["    assert!(total(&cart) > 0);"],
      ),
    ).toEqual([weakened]);
  });

  test("an equality kept as an equality is not a weakened test", () => {
    expect(
      modified(
        "test_cart.py",
        ["    assert total(cart) == 600"],
        ["    assert total(cart) == 650"],
      ),
    ).toEqual([]);
    expect(
      modified(
        "cart.rs",
        ["    assert_eq!(total(&cart), 600);"],
        ["    assert_eq!(total(&cart), 650);"],
      ),
    ).toEqual([]);
  });
});

describe("gateFiles", () => {
  test("names the files a gate command runs and the task files its runner reads", () => {
    const files = gateFiles([
      "sh scripts/lint.sh",
      "./check.py --strict",
      "make -C web test",
      "make --directory=api -f ci.mk check",
      "just ci",
      "cd tools && sh ./run.sh",
      "bun run test",
      "NODE_ENV=test bunx vitest run",
    ]);
    expect([...files.keys()].sort()).toEqual([
      ".justfile",
      "Justfile",
      "api/GNUmakefile",
      "api/Makefile",
      "api/ci.mk",
      "api/makefile",
      "check.py",
      "ci.mk",
      "justfile",
      "scripts/lint.sh",
      "tools/run.sh",
      "web/GNUmakefile",
      "web/Makefile",
      "web/makefile",
    ]);
    expect(files.get("scripts/lint.sh")?.command).toBe("sh scripts/lint.sh");
    expect([...gateFiles(["(cd web && make test)", "echo $(sh ./gen.sh)"]).keys()].sort()).toEqual([
      "gen.sh",
      "web/GNUmakefile",
      "web/Makefile",
      "web/makefile",
    ]);
  });

  test("follows the package.json scripts a gate runs and the files gate files include", async () => {
    const scripts = {
      test: "bun run lint && bun test",
      lint: "sh scripts/lint.sh",
      build: "sh build.sh",
    };
    expect(reachedScripts(["bun run test"], scripts).sort()).toEqual([
      "bun run lint && bun test",
      "sh scripts/lint.sh",
    ]);
    const base: Record<string, string> = {
      Makefile: "include rules/common.mk rules/*.inc\ntest:\n\tsh ./scripts/test.sh\n",
      "rules/common.mk": "-include local.mk\n",
      "scripts/lint.sh": ". ./lib.sh\nlint\n",
    };
    const files = await includedFiles(
      gateFiles(["make test", "sh scripts/lint.sh"]),
      async (path) => base[path] ?? null,
      ["rules/a.inc", "rules/b.inc", "Makefile"],
    );
    expect([...files.keys()]).toContain("rules/a.inc");
    expect([...files.keys()]).toContain("rules/common.mk");
    expect([...files.keys()]).toContain("rules/local.mk");
    expect([...files.keys()]).toContain("scripts/lib.sh");
  });
});
