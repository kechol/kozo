import { describe, expect, test } from "bun:test";
import { exampleCharter, gitRepository } from "@kozo/testing";
import { charterPath, constraintsPath } from "./base-documents.ts";
import { proveLine, runProve } from "./prove.ts";

const constraints = `
version: 1
tests: ["tests/**"]
gates: { unit: { run: "true" } }
levels: { fast: [unit] }
prove:
  - files: ["tests/**/*.test.sh"]
    run: for f in {files}; do sh "$f" || exit 1; done
`;

const checksTwo = 'test "$(cat src/value.txt)" = 2\n';

async function repository(documents = constraints) {
  const repo = await gitRepository();
  const base = await repo.commit({
    [charterPath]: exampleCharter,
    [constraintsPath]: documents,
    "src/value.txt": "1\n",
    "src/old.txt": "old\n",
  });
  return { repo, base };
}

async function prove(cwd: string, base: string, mode?: "reproduce" | "preserve") {
  let log = "";
  const result = await runProve({ cwd, base, mode, log: (text) => (log += text) });
  return { result, log, line: proveLine(result) };
}

describe("runProve", () => {
  test("a test that fails without the change proves it", async () => {
    const { repo, base } = await repository();
    await using _ = repo;
    await repo.commit({ "src/value.txt": "2\n", "tests/value.test.sh": checksTwo });
    const { result, line } = await prove(repo.path, base);
    expect(result.status).toBe("pass");
    expect(
      "runs" in result && result.runs.map((run) => [run.withChange, run.withoutChange]),
    ).toEqual([[0, 1]]);
    expect(line).toBe("KOZO_PROVE: status=pass tests=1 reverted=1");
  });

  test("a test that passes without the change does not prove it", async () => {
    const { repo, base } = await repository();
    await using _ = repo;
    await repo.commit({ "src/value.txt": "2\n", "tests/always.test.sh": "true\n" });
    const { log, line } = await prove(repo.path, base);
    expect(line).toBe("KOZO_PROVE: status=fail reason=passes-without-change tests=1 reverted=1");
    expect(log).toContain(
      "the tests pass without the change, so they do not prove it: tests/always.test.sh",
    );
  });

  test("a test that fails with the change is a failure before anything is reverted", async () => {
    const { repo, base } = await repository();
    await using _ = repo;
    await repo.commit({ "src/value.txt": "3\n", "tests/value.test.sh": checksTwo });
    const { result, line } = await prove(repo.path, base);
    expect(line).toBe("KOZO_PROVE: status=fail reason=fails-with-change tests=1 reverted=1");
    expect("runs" in result && result.runs[0]?.withoutChange).toBeNull();
  });

  test("a diff without a runnable changed test fails", async () => {
    const { repo, base } = await repository();
    await using _ = repo;
    await repo.commit({ "src/value.txt": "2\n", "tests/helper.sh": "echo help\n" });
    expect((await prove(repo.path, base)).line).toBe(
      "KOZO_PROVE: status=fail reason=no-tests tests=0 reverted=1",
    );
  });

  test("in preserve mode, the changed tests must pass without the change too, and none may change", async () => {
    const { repo, base } = await repository();
    await using _ = repo;
    await repo.git("checkout", "--quiet", "-b", "keeps");
    await repo.commit({ "src/old.txt": "older\n" });
    expect((await prove(repo.path, base, "preserve")).line).toBe(
      "KOZO_PROVE: status=pass mode=preserve tests=0 reverted=1",
    );
    await repo.commit({ "tests/one.test.sh": 'test "$(cat src/value.txt)" = 1\n' });
    expect((await prove(repo.path, base, "preserve")).line).toBe(
      "KOZO_PROVE: status=pass mode=preserve tests=1 reverted=1",
    );
    await repo.git("checkout", "--quiet", "-b", "changes", base);
    await repo.commit({ "src/value.txt": "2\n", "tests/two.test.sh": checksTwo });
    const changed = await prove(repo.path, base, "preserve");
    expect(changed.line).toBe(
      "KOZO_PROVE: status=fail reason=fails-without-change mode=preserve tests=1 reverted=1",
    );
    expect(changed.log).toContain(
      "the tests fail without the change, so it changes the behaviour they pin: tests/two.test.sh",
    );
  });

  test("added, modified and deleted files are reverted and then restored", async () => {
    const { repo, base } = await repository();
    await using _ = repo;
    const check = [
      'test "$(cat src/value.txt)" = 2',
      "test -f src/new.txt",
      "test ! -e src/old.txt",
    ].join(" && ");
    const head = await repo.commit({
      "src/value.txt": "2\n",
      "src/new.txt": "new\n",
      "src/old.txt": null,
      "tests/files.test.sh": `${check}\n`,
    });
    const { result } = await prove(repo.path, base);
    expect(result.status === "pass" && result.reverted.sort()).toEqual([
      "src/new.txt",
      "src/old.txt",
      "src/value.txt",
    ]);
    expect(await repo.git("status", "--porcelain")).toBe("");
    expect(await repo.git("rev-parse", "HEAD")).toBe(head);
    expect(await Bun.file(`${repo.path}/src/new.txt`).exists()).toBe(true);
    expect(await Bun.file(`${repo.path}/src/old.txt`).exists()).toBe(false);
  });

  test("test file names are quoted for the shell", async () => {
    const { repo, base } = await repository();
    await using _ = repo;
    await repo.commit({ "src/value.txt": "2\n", "tests/it's here.test.sh": checksTwo });
    const { result } = await prove(repo.path, base);
    expect(result.status === "pass" && result.runs[0]?.command).toBe(
      `for f in 'tests/it'\\''s here.test.sh'; do sh "$f" || exit 1; done`,
    );
  });

  test("a dirty worktree is an error and is left untouched", async () => {
    const { repo, base } = await repository();
    await using _ = repo;
    await repo.commit({ "src/value.txt": "2\n", "tests/value.test.sh": checksTwo });
    await Bun.write(`${repo.path}/src/value.txt`, "work in progress\n");
    const { result } = await prove(repo.path, base);
    expect(result.status).toBe("error");
    expect(await Bun.file(`${repo.path}/src/value.txt`).text()).toBe("work in progress\n");
  });

  test("constraints without prove entries are MISCONFIGURED", async () => {
    const { repo, base } = await repository(constraints.replace(/prove:[\s\S]*$/, ""));
    await using _ = repo;
    await repo.commit({ "src/value.txt": "2\n", "tests/value.test.sh": checksTwo });
    expect((await prove(repo.path, base)).line).toBe(
      "KOZO_PROVE: status=MISCONFIGURED reason=no-prove-entries",
    );
  });
});
