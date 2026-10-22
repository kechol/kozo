import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { factoryTemplate } from "@kozo/core";
import {
  exampleCharter,
  type GitRepository,
  gitRepository,
  type TempDirectory,
  tempDirectory,
  testGitEnvironment,
} from "@kozo/testing";
import { printable } from "./factory-commands.ts";
import { run } from "./index.ts";

const kozod = join(import.meta.dir, "..", "..", "daemon", "src", "main.ts");
let home: TempDirectory;
let repo: GitRepository;
const saved = { ...process.env };

async function kozo(...args: string[]) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = await run(args, {
    stdout: (line) => stdout.push(line),
    stderr: (line) => stderr.push(line),
    rawStdout: (text) => stdout.push(text),
    rawStderr: (text) => stderr.push(text),
  });
  return { code, stdout: stdout.join("\n"), stderr: stderr.join("\n") };
}

beforeAll(async () => {
  home = await tempDirectory();
  repo = await gitRepository();
  await repo.commit({ ".kozo/charter.yml": exampleCharter }, "start");
  await mkdir(join(home.path, "factory"));
  await Bun.write(
    join(home.path, "factory", "factory.yml"),
    `repositories:\n  - { path: ${repo.path} }\n`,
  );
  process.env.KOZO_HOME = home.path;
  process.env.KOZO_PORT = String(18000 + Math.floor(Math.random() * 1000));
  process.env.KOZOD = kozod;
});

afterAll(async () => {
  await kozo("down");
  process.env = saved;
  await repo[Symbol.asyncDispose]();
  await home[Symbol.asyncDispose]();
});

describe("the daily commands", () => {
  test("status before kozod has run fails with a hint, and --line says down", async () => {
    expect(await kozo("status")).toMatchObject({
      code: 1,
      stderr: expect.stringContaining("kozo up"),
    });
    expect(await kozo("status", "--line")).toMatchObject({ code: 1, stdout: "kozo: down" });
  });

  test("up starts kozod once, and the commands reach it", async () => {
    const started = await kozo("up");
    expect(started).toMatchObject({ code: 0 });
    expect(started.stdout).toStartWith("kozod is up: http://127.0.0.1:");
    expect((await kozo("up")).stdout).toStartWith("kozod is already running");

    const added = await kozo(
      "add",
      "Reject a blank quantity\nAdding an empty quantity breaks the line.",
    );
    expect(added).toEqual({
      code: 3,
      stdout: "added K-1; it waits for your start approval",
      stderr: "",
    });
    expect((await kozo("add", "reject a blank quantity")).code).toBe(1);
    expect((await kozo("add", "--class", "nonsense", "x")).code).toBe(2);

    const inbox = await kozo("ls");
    expect(inbox.stdout).toBe("K-1  approval  Reject a blank quantity (start approval)");
    const items = await kozo("ls", "items", "--json");
    expect(JSON.parse(items.stdout)).toMatchObject({
      items: [{ ref: "K-1", shown_stage: "intake" }],
    });

    const shown = await kozo("show", "K-1");
    expect(shown.stdout).toContain("stage      intake");
    expect(shown.stdout).toContain("hold       approval (start approval)");
    expect((await kozo("show", "K-9")).code).toBe(4);
    expect((await kozo("show", "nope")).code).toBe(2);

    expect((await kozo("status", "--line")).stdout).toMatch(
      /^kozo: up local · 0 running · 1 waiting · \$0\.00 today$/,
    );
    expect(JSON.parse((await kozo("status", "--json")).stdout)).toMatchObject({
      running: true,
      waiting: 1,
    });
    expect((await kozo("approve", "r-0001")).code).toBe(2);
    expect((await kozo("show", "K-1", "--diff")).code).toBe(2);
    expect((await kozo("admin", "db-rebuild")).stdout).toBe("rebuilt kozo.db from the event logs");
    expect((await kozo("ls", "items")).stdout).toContain("K-1");
    expect((await kozo("say", "K-1")).code).toBe(2);

    const stopped = await kozo("down");
    expect(stopped).toMatchObject({ stdout: "kozod is down" });
    expect((await kozo("down")).stdout).toBe("kozod is not running");
    expect((await kozo("ls")).code).toBe(1);
  }, 60_000);
});

describe("printable", () => {
  test("removes control characters and escape sequences but keeps tabs", () => {
    expect(printable("ok\u001b]0;pwned\u0007\u001b[2Jdone\tnext\r\n\u009b")).toBe(
      "ok]0;pwned[2Jdone\tnext",
    );
  });
});

describe("kozo admin init", () => {
  // Bun.spawn does not see changes to process.env, so the CLI runs in a process of its own with
  // the test git environment, which keeps the developer's signing and hooks out.
  const init = (home: string) => {
    const child = Bun.spawnSync(["bun", join(import.meta.dir, "main.ts"), "admin", "init"], {
      env: { ...testGitEnvironment, KOZO_HOME: home },
    });
    return {
      code: child.exitCode,
      stdout: child.stdout.toString(),
      stderr: child.stderr.toString(),
    };
  };

  test("creates the factory definition from the template, committed on main, and only once", async () => {
    await using other = await tempDirectory();
    expect(init(other.path)).toMatchObject({
      code: 0,
      stdout: expect.stringContaining("factory.yml"),
    });
    const factory = join(other.path, "factory");
    expect(await Bun.file(join(factory, "agents", "plan", "agent.md")).text()).toBe(
      factoryTemplate["agents/plan/agent.md"],
    );
    const log = Bun.spawnSync(["git", "log", "--format=%s %an", "main"], {
      cwd: factory,
      env: testGitEnvironment,
    });
    expect(log.stdout.toString().trim()).toBe("Start the factory definition kozo test");
    expect(init(other.path)).toMatchObject({
      code: 1,
      stderr: expect.stringContaining("is not empty"),
    });
  });
});
