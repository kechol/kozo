import { describe, expect, test } from "bun:test";
import { chmod, mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  exampleCharter,
  gitRepository,
  suiteBase,
  tempDirectory,
  testGitEnvironment,
} from "@kozo/testing";
import { run } from "./index.ts";

async function kozo(...args: string[]) {
  const stdout: string[] = [];
  const code = await run(args, {
    stdout: (line) => stdout.push(line),
    stderr: () => {},
    rawStdout: () => {},
    rawStderr: () => {},
  });
  return { code, stdout: stdout.join("\n") };
}

describe("kozo check <path>", () => {
  test("checks a factory definition in a working tree", async () => {
    await using dir = await tempDirectory({ "factory.yml": "concurrency: 2\n" });
    expect(await kozo("check", dir.path)).toEqual({
      code: 0,
      stdout: `ok    factory definition: ${dir.path}`,
    });
    await Bun.write(join(dir.path, "factory.yml"), "concurrency: none\n");
    const failed = await kozo("check", dir.path, "--json");
    expect(failed.code).toBe(1);
    expect(JSON.parse(failed.stdout)).toMatchObject({
      ok: false,
      checks: [{ name: "factory definition", status: "fail" }],
    });
  });

  test("checks a repository's .kozo/ in a working tree", async () => {
    await using dir = await tempDirectory({
      ".kozo/charter.yml": exampleCharter.replace("status: ready", "status: incomplete"),
    });
    const result = await kozo("check", dir.path);
    expect(result.code).toBe(1);
    expect(result.stdout.split("\n")).toEqual([
      `warn  ${dir.path} Charter: status is incomplete; kozo does not work here until it is ready`,
      `fail  ${dir.path} constraints: .kozo/constraints.yml is missing`,
      `warn  ${dir.path} verify-app: .kozo/verify-app.md is missing, so verify does not run`,
    ]);
    await Bun.write(
      join(dir.path, ".kozo", "constraints.yml"),
      suiteBase[".kozo/constraints.yml"] ?? "",
    );
    expect((await kozo("check", dir.path)).code).toBe(0);
  });

  test("refuses a directory that is neither", async () => {
    await using dir = await tempDirectory({ "README.md": "# Shop\n" });
    expect(await kozo("check", dir.path)).toMatchObject({
      code: 1,
      stdout: expect.stringContaining("neither a factory definition"),
    });
  });
});

describe("kozo check", () => {
  // The checks run claude and git in child processes, which see only an environment given to
  // them, so the CLI runs in a process of its own.
  test("checks the definition, every repository, claude and the sandbox", async () => {
    await using home = await tempDirectory();
    await using repo = await gitRepository();
    await repo.commit({ ".kozo/charter.yml": exampleCharter }, "start");
    await mkdir(join(home.path, "factory"));
    await Bun.write(
      join(home.path, "factory", "factory.yml"),
      `repositories:\n  - { path: ${repo.path} }\n`,
    );
    const claude = join(home.path, "claude");
    const flags = [
      "--output-format",
      "--input-format",
      "--json-schema",
      "--model",
      "--system-prompt",
      "--allowed-tools",
      "--permission-mode",
      "--setting-sources",
      "--strict-mcp-config",
      "--mcp-config",
      "--max-budget-usd",
    ];
    await Bun.write(
      claude,
      `#!/bin/sh
case "$1" in
  --version) echo "9.9.9 (Claude Code)" ;;
  --help) echo "${flags.join(" ")}" ;;
  auth) echo '{"loggedIn":true,"authMethod":"claude.ai","email":"someone@example.com"}' ;;
esac
`,
    );
    await chmod(claude, 0o755);
    const child = Bun.spawnSync(["bun", join(import.meta.dir, "main.ts"), "check", "--json"], {
      env: { ...testGitEnvironment, KOZO_HOME: home.path, KOZO_CLAUDE: claude },
    });
    const report = JSON.parse(child.stdout.toString()) as {
      ok: boolean;
      checks: { name: string; status: string; detail: string }[];
    };
    expect(child.exitCode).toBe(1);
    expect(report.checks.map(({ name, status }) => [name, status])).toEqual([
      ["factory definition", "ok"],
      [`${repo.path} Charter`, "ok"],
      [`${repo.path} constraints`, "fail"],
      [`${repo.path} verify-app`, "warn"],
      ["claude", "ok"],
      ["claude flags", "fail"],
      ["claude sign-in", "ok"],
      ["hooks", "ok"],
      ["sandbox", expect.any(String)],
    ]);
    expect(report.checks.find((entry) => entry.name === "claude flags")?.detail).toBe(
      "missing --no-session-persistence; update claude",
    );
    expect(child.stdout.toString()).not.toContain("someone@example.com");
  });
});
