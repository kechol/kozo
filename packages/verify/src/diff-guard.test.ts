import { describe, expect, test } from "bun:test";
import { gitRepository } from "@kozo/testing";
import { charterPath } from "./base-documents.ts";
import { diffGuardLine, runDiffGuard } from "./diff-guard.ts";
import { constraintsPath } from "./gates.ts";

const charter = `
version: 1
status: ready
isolation: worktree
protected_paths: [".kozo/**", "**/migrations/**", "AGENTS.md"]
existing_tests_protected: true
levels: { default: L1 }
limits:
  max_changed_lines: 10
  max_files: 3
  max_tasks_per_item: 8
  inner_retries: 2
  ci_fix_rounds: 2
  no_progress_rounds: 3
  max_turns: 40
  max_minutes: 45
  max_cost_usd: 5
backpressure: { max_awaiting_merge: 3, max_held: 10 }
`;

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

  test("files outside the scope are violations", async () => {
    const { repo, base } = await repository();
    await using _ = repo;
    await repo.commit({ "src/cart.ts": "export const cart = 2;\n", "docs/guide.md": "New\n" });
    const { result } = await guard(repo.path, base, ["src/**"]);
    expect("violations" in result && result.violations).toEqual([
      { kind: "out-of-scope", path: "docs/guide.md" },
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
