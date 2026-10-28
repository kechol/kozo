import { describe, expect, test } from "bun:test";
import { exampleCharter, gitRepository } from "@kozo/testing";
import { charterPath, constraintsPath } from "./base-documents.ts";
import { diffGuardLine, runDiffGuard } from "./diff-guard.ts";

const charter = exampleCharter
  .replace("max_changed_lines: 400", "max_changed_lines: 10")
  .replace("max_files: 8", "max_files: 3");

const constraints = `
version: 1
tests: ["**/*.test.ts", "tests/**"]
gates: { unit: { run: "true" } }
levels: { fast: [unit] }
`;

async function repository() {
  const repo = await gitRepository();
  const base = await repo.commit({
    [charterPath]: charter,
    [constraintsPath]: constraints,
    "src/cart.ts": "export const cart = 1;\n",
    "src/cart.test.ts": "test('cart', () => {});\n",
    "tests/support.ts": "export const db = 1;\n",
    "docs/guide.md": "Guide\n",
  });
  return { repo, base };
}

async function guard(cwd: string, base: string, scope?: string[]) {
  let log = "";
  const result = await runDiffGuard({ cwd, base, head: "HEAD", scope, log: (t) => (log += t) });
  return { result, log, line: diffGuardLine(result) };
}

function kinds(result: Awaited<ReturnType<typeof guard>>["result"]) {
  return "violations" in result ? result.violations.map((violation) => violation.kind) : [];
}

describe("runDiffGuard", () => {
  test("a small diff inside the scope with a new test passes", async () => {
    const { repo, base } = await repository();
    await using _ = repo;
    await repo.commit({
      "src/cart.ts": "export const cart = 2;\n",
      "src/total.test.ts": "test('total', () => {});\n",
    });
    const { result, line } = await guard(repo.path, base, ["src/**"]);
    expect(result.status).toBe("pass");
    expect("files" in result && result.files).toEqual([
      { path: "src/cart.ts", change: "modified", lines: 2 },
      { path: "src/total.test.ts", change: "added", lines: 1 },
    ]);
    expect(line).toBe("KOZO_DIFF_GUARD: status=pass lines=3/10 files=2/3");
  });

  test("lines and files over the Charter limits are violations", async () => {
    const { repo, base } = await repository();
    await using _ = repo;
    await repo.commit({
      "src/a.ts": "1\n2\n3\n4\n5\n6\n",
      "src/b.ts": "1\n2\n3\n4\n5\n6\n",
      "src/c.ts": "1\n",
      "src/d.ts": "1\n",
    });
    const { result, log, line } = await guard(repo.path, base);
    expect(kinds(result)).toEqual(["lines", "files"]);
    expect(log).toContain("the diff changes 14 lines; the Charter allows 10");
    expect(line).toBe("KOZO_DIFF_GUARD: status=fail lines=14/10 files=4/3 violations=lines,files");
  });

  test("generated files count apart from the limits, and every other check still sees them", async () => {
    const repo = await gitRepository();
    await using _ = repo;
    const base = await repo.commit({
      [charterPath]: charter,
      [constraintsPath]: `${constraints}generated: ["**/*.lock", "gen/**"]\n`,
      "src/cart.ts": "export const cart = 1;\n",
    });
    const lock = Array.from({ length: 30 }, (_, index) => `line ${index}`).join("\n");
    await repo.commit({
      "src/cart.ts": "export const cart = 2;\n",
      "bun.lock": `${lock}\n`,
      "web/yarn.lock": `${lock}\n`,
      "gen/api.ts": `${lock}\n`,
    });
    const passed = await guard(repo.path, base, ["src/**", "gen/**", "**/*.lock"]);
    expect(passed.result.status).toBe("pass");
    expect(passed.line).toBe(
      "KOZO_DIFF_GUARD: status=pass lines=2/10 files=1/3 generated=3files,90lines",
    );
    // A generated file outside the scope is still out of it.
    const scoped = await guard(repo.path, base, ["src/**"]);
    expect(kinds(scoped.result)).toEqual(["out-of-scope", "out-of-scope", "out-of-scope"]);
  });

  test("files outside the scope are violations", async () => {
    const { repo, base } = await repository();
    await using _ = repo;
    await repo.commit({ "src/cart.ts": "export const cart = 2;\n", "docs/guide.md": "New\n" });
    const { result } = await guard(repo.path, base, ["src/**"]);
    expect("violations" in result && result.violations).toEqual([
      { kind: "out-of-scope", path: "docs/guide.md" },
    ]);
  });

  test("a new test case may sit outside the scope, a new setup file may not", async () => {
    const { repo, base } = await repository();
    await using _ = repo;
    await repo.commit({
      "src/cart.ts": "export const cart = 2;\n",
      "tests/cart-total.test.ts": "test\n",
      "tests/setup.ts": "globalThis.x = 1;\n",
    });
    const { result } = await guard(repo.path, base, ["src/**"]);
    expect("violations" in result && result.violations).toEqual([
      { kind: "out-of-scope", path: "tests/setup.ts" },
    ]);
  });

  test("a protected path is a violation, including a new file under it", async () => {
    const { repo, base } = await repository();
    await using _ = repo;
    await repo.commit({ "db/migrations/0001.sql": "create table t ();\n", "AGENTS.md": "Hi\n" });
    const { result } = await guard(repo.path, base);
    expect("violations" in result && result.violations).toEqual([
      { kind: "protected-path", path: "AGENTS.md", pattern: "AGENTS.md" },
      { kind: "protected-path", path: "db/migrations/0001.sql", pattern: "**/migrations/**" },
    ]);
  });

  test("a protected path or scope that names a directory covers everything under it", async () => {
    const repo = await gitRepository();
    await using _ = repo;
    const base = await repo.commit({
      [charterPath]: charter.replace(
        '  - "AGENTS.md"\n',
        '  - "AGENTS.md"\n  - "db/schema"\n  - "lib/vendor/"\n',
      ),
      [constraintsPath]: constraints,
    });
    await repo.commit({ "db/schema/users.sql": "x\n", "lib/vendor/pay.ts": "x\n" });
    const { result } = await guard(repo.path, base, ["db/schema"]);
    expect("violations" in result && result.violations).toEqual([
      { kind: "protected-path", path: "db/schema/users.sql", pattern: "db/schema" },
      { kind: "out-of-scope", path: "lib/vendor/pay.ts" },
      { kind: "protected-path", path: "lib/vendor/pay.ts", pattern: "lib/vendor/" },
    ]);
  });

  test("modifying, deleting or renaming an existing test file is a violation", async () => {
    const { repo, base } = await repository();
    await using _ = repo;
    await repo.git("mv", "src/cart.test.ts", "src/basket.test.ts");
    await repo.commit({ "tests/support.ts": "export const db = 2;\n" });
    const { result } = await guard(repo.path, base);
    expect("violations" in result && result.violations).toEqual([
      { kind: "existing-test", path: "src/cart.test.ts", change: "deleted" },
      { kind: "existing-test", path: "tests/support.ts", change: "modified" },
    ]);
  });

  test("existing tests may change when the Charter allows it", async () => {
    const repo = await gitRepository();
    await using _ = repo;
    const base = await repo.commit({
      [charterPath]: charter.replace(
        "existing_tests_protected: true",
        "existing_tests_protected: false",
      ),
      [constraintsPath]: constraints,
      "src/cart.test.ts": "test('cart', () => {});\n",
    });
    await repo.commit({ "src/cart.test.ts": "test('cart', () => { expect(1).toBe(1); });\n" });
    expect((await guard(repo.path, base)).result.status).toBe("pass");
  });

  test("the Charter comes from the base commit, so a diff cannot loosen it", async () => {
    const { repo, base } = await repository();
    await using _ = repo;
    await repo.commit({
      [charterPath]: charter.replace("max_files: 3", "max_files: 30"),
      "src/a.ts": "1\n",
      "src/b.ts": "1\n",
      "src/c.ts": "1\n",
    });
    const { result } = await guard(repo.path, base);
    expect(kinds(result)).toEqual(["files", "protected-path"]);
  });

  test("the base is the merge base when the base branch has moved on", async () => {
    const { repo, base } = await repository();
    await using _ = repo;
    await repo.git("switch", "--quiet", "-c", "task");
    await repo.commit({ "src/cart.ts": "export const cart = 2;\n" });
    await repo.git("switch", "--quiet", "main");
    await repo.commit({ "docs/guide.md": "Moved on\n" });
    await repo.git("switch", "--quiet", "task");
    const { result } = await guard(repo.path, "main", ["src/**"]);
    expect(result.status === "pass" && result.base).toBe(base);
  });

  test("a branch forked before the Charter was tightened is judged by the current Charter", async () => {
    const repo = await gitRepository();
    await using _ = repo;
    const loose = await repo.commit({
      [charterPath]: charter.replace("max_files: 3", "max_files: 30"),
      [constraintsPath]: constraints,
    });
    await repo.commit({ [charterPath]: charter });
    await repo.git("switch", "--quiet", "-c", "task", loose);
    await repo.commit({
      "src/a.ts": "1\n",
      "src/b.ts": "1\n",
      "src/c.ts": "1\n",
      "src/d.ts": "1\n",
    });
    const { result } = await guard(repo.path, "main");
    expect(result.status === "fail" && result.base).toBe(loose);
    expect(kinds(result)).toEqual(["files"]);
  });

  test("a path containing a tab is counted whole", async () => {
    const { repo, base } = await repository();
    await using _ = repo;
    await repo.commit({ "src/odd\tname.ts": "1\n2\n" });
    const { result } = await guard(repo.path, base);
    expect("files" in result && result.files).toEqual([
      { path: "src/odd\tname.ts", change: "added", lines: 2 },
    ]);
  });

  test("a missing or invalid Charter at the base is MISCONFIGURED", async () => {
    const repo = await gitRepository();
    await using _ = repo;
    const base = await repo.commit({ [constraintsPath]: constraints });
    await repo.commit({ "src/a.ts": "1\n" });
    expect((await guard(repo.path, base)).line).toBe(
      "KOZO_DIFF_GUARD: status=MISCONFIGURED reason=charter-missing",
    );
    const broken = await repo.commit({ [charterPath]: "version: 1\n" });
    await repo.commit({ "src/b.ts": "1\n" });
    const { log, line } = await guard(repo.path, broken);
    expect(line).toBe("KOZO_DIFF_GUARD: status=MISCONFIGURED reason=charter-invalid");
    expect(log).toContain("status: Invalid option");
  });

  test("an unknown base is an error", async () => {
    const { repo } = await repository();
    await using _ = repo;
    const { result, line } = await guard(repo.path, "no-such-branch");
    expect(result.status).toBe("error");
    expect(line).toBe("KOZO_DIFF_GUARD: status=error");
  });
});

describe("runDiffGuard on weakened tests", () => {
  test("disabled tests, weakened assertions and changed gate scripts are violations", async () => {
    const repo = await gitRepository();
    await using _ = repo;
    const base = await repo.commit({
      [charterPath]: charter
        .replace("existing_tests_protected: true", "existing_tests_protected: false")
        .replace("max_changed_lines: 10", "max_changed_lines: 100"),
      [constraintsPath]: constraints.replace('run: "true"', 'run: "pnpm test"'),
      "package.json": JSON.stringify({ scripts: { test: "vitest run", dev: "next dev" } }),
      "src/cart.test.ts": "test('total', () => {\n  expect(total()).toBe(3);\n});\n",
    });
    await repo.commit({
      "package.json": JSON.stringify({ scripts: { test: "vitest run || true", dev: "next" } }),
      "src/cart.test.ts": "test('total', () => {\n  expect(total()).toBeTruthy();\n});\n",
      "src/new.test.ts": "test.only('new', () => {});\n",
    });
    const { result, log } = await guard(repo.path, base);
    expect("violations" in result && result.violations).toEqual([
      {
        kind: "weakened-test",
        path: "src/cart.test.ts",
        reason: "strict matchers replaced by weak ones",
      },
      { kind: "disabled-test", path: "src/new.test.ts", line: 1, marker: "only" },
      { kind: "gate-script", path: "package.json", script: "test" },
    ]);
    expect(log).toContain('the script "test" in package.json, which a gate runs, was changed');
  });
});

describe("runDiffGuard against evasion", () => {
  test("a .gitattributes entry cannot hide a test file's lines", async () => {
    const repo = await gitRepository();
    await using _ = repo;
    const base = await repo.commit({
      [charterPath]: charter.replace(
        "existing_tests_protected: true",
        "existing_tests_protected: false",
      ),
      [constraintsPath]: constraints,
      ".gitattributes": "*.test.ts binary\n",
      "src/cart.test.ts": "test('total', () => {});\n",
    });
    await repo.commit({ "src/cart.test.ts": "test.skip('total', () => {});\n" });
    const { result } = await guard(repo.path, base);
    expect(result.status === "fail" && result.lines).toBe(2);
    expect(kinds(result)).toEqual(["disabled-test"]);
  });

  test("scripts in a workspace package.json are covered", async () => {
    const repo = await gitRepository();
    await using _ = repo;
    const base = await repo.commit({
      [charterPath]: charter,
      [constraintsPath]: constraints.replace('run: "true"', 'run: "pnpm -r test"'),
      "packages/core/package.json": JSON.stringify({ scripts: { test: "vitest run" } }),
    });
    await repo.commit({
      "packages/core/package.json": JSON.stringify({ scripts: { test: "true" } }),
    });
    const { result } = await guard(repo.path, base);
    expect("violations" in result && result.violations).toEqual([
      { kind: "gate-script", path: "packages/core/package.json", script: "test" },
    ]);
  });
});

describe("runDiffGuard base refs", () => {
  test("a tag named like the base branch cannot stand in for it", async () => {
    const repo = await gitRepository();
    await using _ = repo;
    const loose = await repo.commit({
      [charterPath]: charter.replace("max_files: 3", "max_files: 30"),
      [constraintsPath]: constraints,
    });
    await repo.commit({ [charterPath]: charter });
    await repo.git("tag", "main", loose);
    await repo.git("switch", "--quiet", "-c", "task");
    await repo.commit({
      "src/a.ts": "1\n",
      "src/b.ts": "1\n",
      "src/c.ts": "1\n",
      "src/d.ts": "1\n",
    });
    const { result } = await guard(repo.path, "main");
    expect(kinds(result)).toEqual(["files"]);
  });

  test("a tag named like the head branch cannot stand in for it", async () => {
    const repo = await gitRepository();
    await using _ = repo;
    await repo.commit({ [charterPath]: charter, [constraintsPath]: constraints });
    await repo.git("switch", "--quiet", "-c", "task");
    await repo.commit({
      "src/a.ts": "1\n",
      "src/b.ts": "1\n",
      "src/c.ts": "1\n",
      "src/d.ts": "1\n",
    });
    await repo.git("tag", "task", "main");
    await repo.git("switch", "--quiet", "main");
    const result = await runDiffGuard({
      cwd: repo.path,
      base: "main",
      head: "task",
      log: () => {},
    });
    expect(kinds(result)).toEqual(["files"]);
  });
});
