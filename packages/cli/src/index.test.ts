import { describe, expect, test } from "bun:test";
import pkg from "../package.json" with { type: "json" };
import { ExitCode, run } from "./index.ts";

function capture(args: string[]) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = run(args, { stdout: (t) => stdout.push(t), stderr: (t) => stderr.push(t) });
  return { code, stdout: stdout.join("\n"), stderr: stderr.join("\n") };
}

describe("kozo", () => {
  test("--version prints the package version", () => {
    const result = capture(["--version"]);
    expect(result.code).toBe(ExitCode.success);
    expect(result.stdout).toBe(`kozo ${pkg.version}`);
  });

  test("an unknown command is a usage error", () => {
    const result = capture(["frobnicate"]);
    expect(result.code).toBe(ExitCode.usage);
    expect(result.stderr).toContain("unknown command 'frobnicate'");
  });

  test("no command prints the usage", () => {
    const result = capture([]);
    expect(result.code).toBe(ExitCode.usage);
    expect(result.stderr).toStartWith("Usage: kozo");
  });
});
