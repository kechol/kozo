import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { exampleCharter, gitRepository, tempDirectory } from "@kozo/testing";
import pkg from "../package.json" with { type: "json" };
import { detailLines } from "./factory-commands.ts";
import { ExitCode, run, usageText } from "./index.ts";
import { words } from "./words.ts";

// Every run reads the factory's locale from KOZO_HOME, so the tests start from a home of their
// own rather than the machine's.
let machineHome: string | undefined;
let ownHome: Awaited<ReturnType<typeof tempDirectory>>;
beforeAll(async () => {
  machineHome = process.env.KOZO_HOME;
  ownHome = await tempDirectory();
  process.env.KOZO_HOME = ownHome.path;
});
afterAll(async () => {
  if (machineHome === undefined) delete process.env.KOZO_HOME;
  else process.env.KOZO_HOME = machineHome;
  await ownHome[Symbol.asyncDispose]();
});

async function capture(args: string[], cwd?: string) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  let raw = "";
  const code = await run(
    args,
    {
      stdout: (line) => stdout.push(line),
      stderr: (line) => stderr.push(line),
      rawStdout: (text) => (raw += text),
      rawStderr: (text) => (raw += text),
    },
    cwd,
  );
  return { code, stdout: stdout.join("\n"), stderr: stderr.join("\n"), raw };
}

describe("kozo", () => {
  test("--version prints the package version", async () => {
    const result = await capture(["--version"]);
    expect(result.code).toBe(ExitCode.success);
    expect(result.stdout).toBe(`kozo ${pkg.version}`);
  });

  test("an unknown command is a usage error", async () => {
    const result = await capture(["frobnicate"]);
    expect(result.code).toBe(ExitCode.usage);
    expect(result.stderr).toContain("unknown command 'frobnicate'");
  });

  test("no command prints the usage", async () => {
    const result = await capture([]);
    expect(result.code).toBe(ExitCode.usage);
    expect(result.stderr).toStartWith("Usage: kozo");
  });
});

describe("the factory's locale", () => {
  async function inJapanese<T>(work: () => Promise<T>): Promise<T> {
    await using home = await tempDirectory({ "factory/factory.yml": "locale: ja\n" });
    const saved = process.env.KOZO_HOME;
    process.env.KOZO_HOME = home.path;
    try {
      return await work();
    } finally {
      if (saved === undefined) delete process.env.KOZO_HOME;
      else process.env.KOZO_HOME = saved;
    }
  }

  test("a factory definition with locale: ja words the usage and the errors in Japanese", async () => {
    const unknown = await inJapanese(() => capture(["frobnicate"]));
    expect(unknown.code).toBe(ExitCode.usage);
    expect(unknown.stderr).toStartWith(
      "kozo: コマンド 'frobnicate' はありません\n\n使い方: kozo <command>",
    );
    const missing = await inJapanese(() => capture(["diff-guard"]));
    expect(missing.stderr).toStartWith("kozo: diff-guard には --base <ref> が必要です");
  });

  test("without a readable factory definition the CLI speaks English", async () => {
    await using home = await tempDirectory();
    const saved = process.env.KOZO_HOME;
    process.env.KOZO_HOME = home.path;
    try {
      expect((await capture([])).stderr).toBe(usageText("en"));
    } finally {
      if (saved === undefined) delete process.env.KOZO_HOME;
      else process.env.KOZO_HOME = saved;
    }
  });

  test("kozo check words its check names and details in Japanese", async () => {
    await using dir = await tempDirectory({ "README.md": "# Shop\n" });
    const result = await inJapanese(() => capture(["check", dir.path]));
    expect(result.code).toBe(ExitCode.failure);
    expect(result.stdout).toBe(
      `fail  ${dir.path}: factory definition（factory.yml、agents/）でも、.kozo/ のあるリポジトリでもありません`,
    );
  });

  test("kozo show words its detail lines in the given locale", () => {
    const run = {
      ref: "r-0001",
      agent: "builder",
      model: "m",
      state: "done",
      task: "K-1/t1",
      parent: "r-0000",
    };
    const body = { kind: "run", run, events: 3, cost_usd: 0.5 };
    expect(detailLines(body)).toContain("for        K-1/t1 under r-0000");
    expect(detailLines(body, words("ja"))).toContain("for        K-1/t1（r-0000 の下）");
  });
});

describe("kozo gates", () => {
  const constraints =
    "version: 1\ntests: [t.ts]\ngates:\n  ok:\n    run: echo fine\nlevels:\n  full: [ok]\n";

  test("runs the full level by default and ends with the KOZO_GATES line", async () => {
    await using dir = await tempDirectory({ ".kozo/constraints.yml": constraints });
    const result = await capture(["gates"], dir.path);
    expect(result.code).toBe(ExitCode.success);
    expect(result.raw).toBe("==> ok\nfine\n");
    expect(result.stdout).toMatch(/^KOZO_GATES: level=full status=pass gates=ok duration=\d+s$/);
  });

  test("MISCONFIGURED exits with a failure", async () => {
    await using dir = await tempDirectory({ ".kozo/constraints.yml": constraints });
    const result = await capture(["gates", "--level", "fast"], dir.path);
    expect(result.code).toBe(ExitCode.failure);
    expect(result.stdout).toContain("status=MISCONFIGURED reason=level-missing");
  });

  test("--json prints one JSON document carrying the line", async () => {
    await using dir = await tempDirectory({ ".kozo/constraints.yml": constraints });
    const result = await capture(["gates", "--json"], dir.path);
    const document = JSON.parse(result.stdout);
    expect(document).toMatchObject({ level: "full", status: "pass", gates: [{ name: "ok" }] });
    expect(document.line).toStartWith("KOZO_GATES: level=full status=pass");
  });

  test("an unknown level or option is a usage error", async () => {
    expect((await capture(["gates", "--level", "medium"])).code).toBe(ExitCode.usage);
    expect((await capture(["gates", "--fast"])).code).toBe(ExitCode.usage);
  });
});

describe("kozo diff-guard", () => {
  test("needs --base", async () => {
    const result = await capture(["diff-guard"]);
    expect(result.code).toBe(ExitCode.usage);
    expect(result.stderr).toContain("diff-guard needs --base <ref>");
  });

  test("checks the diff against the base Charter and ends with its line", async () => {
    await using repo = await gitRepository();
    const base = await repo.commit({
      ".kozo/charter.yml": exampleCharter,
      ".kozo/constraints.yml": "version: 1\ntests: ['**/*.test.ts']\ngates: {}\nlevels: {}\n",
    });
    await repo.commit({ "src/a.ts": "1\n", ".github/ci.yml": "on: push\n" });
    const result = await capture(
      ["diff-guard", "--base", base, "--scope", "src/**", "--json"],
      repo.path,
    );
    expect(result.code).toBe(ExitCode.failure);
    const document = JSON.parse(result.stdout);
    expect(document.violations.map((violation: { kind: string }) => violation.kind)).toEqual([
      "out-of-scope",
      "protected-path",
    ]);
    expect(document.line).toBe(
      "KOZO_DIFF_GUARD: status=fail lines=2/400 files=2/8 violations=out-of-scope,protected-path",
    );
  });
});

describe("kozo prove", () => {
  test("needs --base", async () => {
    const result = await capture(["prove"]);
    expect(result.code).toBe(ExitCode.usage);
    expect(result.stderr).toContain("prove needs --base <ref>");
  });

  test("proves a change and ends with its line", async () => {
    await using repo = await gitRepository();
    const base = await repo.commit({
      ".kozo/charter.yml": exampleCharter,
      ".kozo/constraints.yml": [
        "version: 1",
        "tests: ['tests/**']",
        "gates: {}",
        "levels: {}",
        "prove: [{ files: ['tests/*.sh'], run: 'sh {files}' }]",
      ].join("\n"),
      "value.txt": "1\n",
    });
    await repo.commit({ "value.txt": "2\n", "tests/value.sh": 'test "$(cat value.txt)" = 2\n' });
    const result = await capture(["prove", "--base", base], repo.path);
    expect(result.code).toBe(ExitCode.success);
    expect(result.stdout).toBe("KOZO_PROVE: status=pass tests=1 reverted=1");
    const preserved = await capture(["prove", "--base", base, "--preserve"], repo.path);
    expect(preserved.code).toBe(ExitCode.failure);
    expect(preserved.stdout).toBe(
      "KOZO_PROVE: status=fail reason=fails-without-change mode=preserve tests=1 reverted=1",
    );
  });
});

describe("kozo review", () => {
  test("needs --base, --goal and --done-when", async () => {
    const result = await capture(["review", "--base", "main", "--goal", "x"]);
    expect(result.code).toBe(ExitCode.usage);
    expect(result.stderr).toContain("at least one --done-when");
  });

  test("rejects a cost limit that is not a positive number", async () => {
    const args = ["review", "--base", "main", "--goal", "x", "--done-when", "y", "--max-cost", "0"];
    expect((await capture(args)).code).toBe(ExitCode.usage);
  });
});
