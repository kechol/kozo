import { describe, expect, test } from "bun:test";
import { gitRepository, tempDirectory } from "@kozo/testing";
import { constraintsPath } from "./base-documents.ts";
import { commandEnvironmentFrom } from "./command.ts";
import { gatesLine, runGates } from "./gates.ts";

const constraints = `
version: 1
tests: ["**/*.test.ts"]
gates:
  greet:
    run: printf 'hello'
  marker:
    run: touch ran-marker
  broken:
    run: echo failing >&2; exit 3
levels:
  fast: [greet, marker]
  full: [greet, broken, marker]
`;

async function gatesIn(cwd: string, level: "fast" | "full" | "deep") {
  let log = "";
  const result = await runGates({ cwd, level, log: (text) => (log += text) });
  return { result, log, line: gatesLine(result) };
}

describe("runGates", () => {
  test("passing gates run in order and the line lists them", async () => {
    await using dir = await tempDirectory({ [constraintsPath]: constraints });
    const { result, log, line } = await gatesIn(dir.path, "fast");
    expect(result.status).toBe("pass");
    expect(result.gates.map((gate) => [gate.name, gate.exitCode])).toEqual([
      ["greet", 0],
      ["marker", 0],
    ]);
    expect(await Bun.file(`${dir.path}/ran-marker`).exists()).toBe(true);
    // Output without a trailing newline still leaves the next line on its own.
    expect(log).toBe("==> greet\nhello\n==> marker\n");
    expect(line).toMatch(/^KOZO_GATES: level=fast status=pass gates=greet,marker duration=\d+s$/);
  });

  test("a failing gate stops the level and is named", async () => {
    await using dir = await tempDirectory({ [constraintsPath]: constraints });
    const { result, log, line } = await gatesIn(dir.path, "full");
    expect(result.status).toBe("fail");
    expect(result.gates.map((gate) => [gate.name, gate.exitCode])).toEqual([
      ["greet", 0],
      ["broken", 3],
    ]);
    expect(await Bun.file(`${dir.path}/ran-marker`).exists()).toBe(false);
    expect(log).toContain("failing\n");
    expect(line).toMatch(
      /^KOZO_GATES: level=full status=fail gates=greet,broken failed=broken duration=\d+s$/,
    );
  });

  test("a missing constraints file is MISCONFIGURED", async () => {
    await using dir = await tempDirectory({});
    const { result, line } = await gatesIn(dir.path, "fast");
    expect(result.gates).toEqual([]);
    expect(line).toMatch(
      /^KOZO_GATES: level=fast status=MISCONFIGURED reason=constraints-missing duration=\d+s$/,
    );
  });

  test("an invalid constraints file is MISCONFIGURED and its issues are logged", async () => {
    const invalid = constraints.replace("[greet, marker]", "[greet, lint]");
    await using dir = await tempDirectory({ [constraintsPath]: invalid });
    const { log, line } = await gatesIn(dir.path, "fast");
    expect(log).toContain('levels.fast.1: Gate "lint" is not defined in gates');
    expect(line).toContain("status=MISCONFIGURED reason=constraints-invalid");
  });

  test("a level that the constraints leave out is MISCONFIGURED", async () => {
    await using dir = await tempDirectory({ [constraintsPath]: constraints });
    const { log, line } = await gatesIn(dir.path, "deep");
    expect(log).toContain("defines no deep level");
    expect(line).toContain("status=MISCONFIGURED reason=level-missing");
  });

  test("with a base, the constraints come from its tip, not the worktree", async () => {
    await using repo = await gitRepository();
    const base = await repo.commit({ [constraintsPath]: constraints });
    await repo.commit({ [constraintsPath]: constraints.replace("exit 3", "exit 0") });
    expect((await gatesIn(repo.path, "full")).result.status).toBe("pass");
    let log = "";
    const result = await runGates({ cwd: repo.path, level: "full", base, log: (t) => (log += t) });
    expect(result.status === "fail" && result.failed).toBe("broken");
  });

  test("an unknown base is MISCONFIGURED", async () => {
    await using repo = await gitRepository();
    await repo.commit({ [constraintsPath]: constraints });
    const result = await runGates({ cwd: repo.path, level: "fast", base: "nope", log: () => {} });
    expect(gatesLine(result)).toContain("status=MISCONFIGURED reason=base-unknown");
  });
});

describe("commandEnvironmentFrom", () => {
  test("keeps what a command needs to run and drops every credential", () => {
    expect(
      commandEnvironmentFrom({
        PATH: "/usr/bin",
        HOME: "/home/me",
        GH_TOKEN: "x",
        ANTHROPIC_API_KEY: "x",
        CLAUDE_CODE_OAUTH_TOKEN: "x",
        AWS_SECRET_ACCESS_KEY: "x",
      }),
    ).toEqual({ PATH: "/usr/bin", HOME: "/home/me" });
  });
});
