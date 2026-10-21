import { describe, expect, test } from "bun:test";
import { tempDirectory } from "@kozo/testing";
import pkg from "../package.json" with { type: "json" };
import { ExitCode, run } from "./index.ts";

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

describe("kozo gates", () => {
  const constraints = "version: 1\ngates:\n  ok:\n    run: echo fine\nlevels:\n  full: [ok]\n";

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
