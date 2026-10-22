import { describe, expect, test } from "bun:test";
import { mkdir, realpath } from "node:fs/promises";
import { join } from "node:path";
import { tempDirectory } from "@kozo/testing";
import { runCommand } from "./command.ts";
import {
  type CommandSandbox,
  packageLocks,
  platformConfine,
  seatbelt,
  seatbeltProfile,
} from "./sandbox.ts";

const empty: CommandSandbox = {
  denyRead: [],
  allowRead: [],
  allowWrite: [],
  denyWrite: [],
  network: "local",
};

describe("packageLocks", () => {
  test("holds the lock directories pnpm keeps in /tmp whatever TMPDIR says", () => {
    expect(packageLocks).toContain(`/private/tmp/pnpm-store-operation-locks-${process.getuid?.()}`);
  });
});

describe("seatbeltProfile", () => {
  test("denies by default, quotes paths and leaves out empty lists", () => {
    const profile = seatbeltProfile({ ...empty, allowWrite: ['/w/a"b\\c'], denyRead: ["/home"] });
    expect(profile).toStartWith("(version 1)\n(deny default)\n");
    expect(profile).toContain('(deny file-read* (subpath "/home"))');
    expect(profile).toContain('(allow file-write* (subpath "/w/a\\"b\\\\c"))');
    expect(profile).not.toContain("(allow file-read* (subpath");
    expect(profile).not.toContain("(allow network*)");
    expect(seatbeltProfile({ ...empty, network: "any" })).toContain("(allow network*)");
  });
});

/** Runs `command` confined to `sandbox` in `cwd`, returning its exit code and output. */
async function confined(cwd: string, sandbox: CommandSandbox, command: string) {
  let output = "";
  const code = await runCommand(command, cwd, (text) => (output += text), undefined, {
    confine: seatbelt,
    sandbox,
  });
  return { code, output };
}

describe.skipIf(process.platform !== "darwin")("seatbelt", () => {
  test("is this machine's sandbox", async () => {
    expect(await platformConfine()).toBe(seatbelt);
  });

  test("writes only where allowed, reads all but the denied paths, and has its own TMPDIR", async () => {
    await using dir = await tempDirectory();
    const root = await realpath(dir.path);
    const work = join(root, "home", "worktree");
    await mkdir(work, { recursive: true });
    await Bun.write(join(root, "home", "api.token"), "secret");
    await Bun.write(join(root, "readable"), "open");
    const sandbox = {
      ...empty,
      denyRead: [join(root, "home")],
      allowRead: [work],
      allowWrite: [work],
      denyWrite: [join(work, ".git")],
    };
    const run = (command: string) => confined(work, sandbox, command);

    expect((await run("echo x > made && cat made")).output).toBe("x\n");
    expect((await run(`echo x > "${root}/outside"`)).code).not.toBe(0);
    expect((await run("echo x > .git")).code).not.toBe(0);
    expect((await run(`cat "${root}/home/api.token"`)).code).not.toBe(0);
    expect((await run(`cat "${root}/readable"`)).output).toBe("open");
    // Node resolves a script's path through every directory above it, the denied home included.
    expect((await run("echo 'console.log(1)' > s.js && node s.js")).output).toBe("1\n");
    expect((await run(`ls "${root}/home"`)).code).not.toBe(0);
    const temp = await run('echo x > "$TMPDIR/t" && echo "$TMPDIR"');
    expect(temp.code).toBe(0);
    expect(temp.output).not.toContain(root);
  });

  test("reaches only this machine unless the network is open", async () => {
    await using dir = await tempDirectory();
    const work = await realpath(dir.path);
    // The sandbox refuses a connection at once; outside it, TEST-NET-1 never answers.
    const outbound = `bun -e 'const s = require("net").connect(80, "192.0.2.1"); s.on("error", (e) => { console.log(e.code); process.exit(0) }); setTimeout(() => { console.log("waited"); process.exit(0) }, 1500)'`;
    const local = { ...empty, allowWrite: [work] };
    expect((await confined(work, local, outbound)).output).toBe("ECONNREFUSED\n");
    expect((await confined(work, { ...local, network: "any" }, outbound)).output).toBe("waited\n");
    const server = `bun -e 'const s = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("up") }); console.log(await (await fetch(s.url)).text()); s.stop()'`;
    expect((await confined(work, local, server)).output).toBe("up\n");
  });
});
