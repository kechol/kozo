import { beforeAll, describe, expect, test } from "bun:test";
import { chmod, lstat, mkdir, realpath, stat, symlink } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { tempDirectory } from "@kozo/testing";
import { runCommand } from "./command.ts";
import {
  bubblewrap,
  bubblewrapArgs,
  type CommandSandbox,
  type Confine,
  homeReadable,
  packageLocks,
  platformConfine,
  seatbelt,
  seatbeltProfile,
} from "./sandbox.ts";

const empty: CommandSandbox = {
  denyRead: [],
  allowRead: [],
  denyReadInside: [],
  allowWrite: [],
  denyWrite: [],
  network: "local",
};

describe("packageLocks", () => {
  test("holds the lock directories pnpm keeps in /tmp whatever TMPDIR says", () => {
    const tmp = process.platform === "darwin" ? "/private/tmp" : "/tmp";
    expect(packageLocks).toContain(`${tmp}/pnpm-store-operation-locks-${process.getuid?.()}`);
    expect(packageLocks).toContain(`${tmp}/pnpm-verify-deps-install-locks-${process.getuid?.()}`);
  });
});

describe("homeReadable", () => {
  test("takes each tool's own directory for a PATH entry in the home directory", () => {
    const home = homedir();
    const at = (path: string) => join(home, path);
    const readable = homeReadable({
      PATH: [
        at(".local/share/mise/shims"),
        at(".local/share/mise/installs/node/24/bin"),
        at(".local/bin"),
        at(".bun/bin"),
        at("Library/pnpm"),
        at("bin"),
        home,
        "/usr/bin",
        "node_modules/.bin",
      ].join(":"),
    });
    for (const path of [".local/share/mise", ".local/bin", ".bun", "Library/pnpm", "bin"])
      expect(readable).toContain(at(path));
    expect(readable).toContain(at(".gitconfig"));
    expect(readable).not.toContain(home);
    expect(readable).not.toContain(at(".local"));
    expect(readable).not.toContain("/usr/bin");
    expect(readable.some((path) => path.includes("node_modules"))).toBe(false);
  });
});

describe("seatbeltProfile", () => {
  test("denies by default, quotes paths and leaves out empty lists", () => {
    const profile = seatbeltProfile({ ...empty, allowWrite: ['/w/a"b\\c'], denyRead: ["/home"] });
    expect(profile).toStartWith("(version 1)\n(deny default)\n");
    expect(profile).toContain('(deny file-read-data file-read-xattr (subpath "/home"))');
    expect(profile).toContain('(allow file-write* (subpath "/w/a\\"b\\\\c"))');
    expect(profile).not.toContain("(allow file-read-data");
    expect(profile).not.toContain("(allow network*)");
    expect(seatbeltProfile({ ...empty, network: "any" })).toContain("(allow network*)");
  });
});

describe("bubblewrapArgs", () => {
  test("mounts the system read-only, hides the denied paths and mounts the writable ones on top", async () => {
    await using dir = await tempDirectory();
    const work = join(dir.path, "work");
    await mkdir(join(work, ".git"), { recursive: true });
    await Bun.write(join(dir.path, "token"), "secret");
    const args = bubblewrapArgs({
      ...empty,
      denyRead: [dir.path, join(dir.path, "token"), join(dir.path, "missing")],
      allowRead: [work],
      allowWrite: [work],
      denyWrite: [join(work, ".git")],
    });
    const text = args.join(" ");
    expect(text).toContain("--unshare-net --ro-bind / /");
    expect(text).toContain(`--tmpfs ${dir.path}`);
    expect(text).toContain(`--ro-bind /dev/null ${join(dir.path, "token")}`);
    expect(text).not.toContain("missing");
    expect(text.indexOf(`--bind ${work} ${work}`)).toBeGreaterThan(
      text.indexOf(`--tmpfs ${dir.path}`),
    );
    expect(text).toContain(`--ro-bind ${join(work, ".git")} ${join(work, ".git")}`);
    expect(text).toEndWith(`--remount-ro ${dir.path}`);
    expect(bubblewrapArgs({ ...empty, network: "any" })).not.toContain("--unshare-net");
  });
});

let confine: Confine;

/** Runs `command` confined to `sandbox` in `cwd`, returning its exit code and output. */
async function confined(
  cwd: string,
  sandbox: CommandSandbox,
  command: string,
  env?: Record<string, string>,
) {
  let output = "";
  const code = await runCommand(command, cwd, (text) => (output += text), env, {
    confine,
    sandbox,
  });
  return { code, output };
}

// Where this machine can confine a command at all: not on a platform kozo has no sandbox for,
// nor where bubblewrap is missing or may not create namespaces.
const sandboxed = await platformConfine().then(
  () => true,
  () => false,
);

describe.skipIf(!sandboxed)("this machine's sandbox", () => {
  beforeAll(async () => {
    confine = await platformConfine();
  });

  test("is Seatbelt on macOS", () => {
    if (process.platform === "darwin") expect(confine).toBe(seatbelt);
  });

  test("writes only where allowed, reads all but the denied paths, and has its own TMPDIR", async () => {
    await using dir = await tempDirectory();
    const root = await realpath(dir.path);
    const work = join(root, "home", "worktree");
    await mkdir(work, { recursive: true });
    await Bun.write(join(root, "home", "api.token"), "secret");
    // A worktree's .git file, which bubblewrap can keep read-only only once it exists.
    await Bun.write(join(work, ".git"), "gitdir: elsewhere\n");
    const sandbox = {
      ...empty,
      denyRead: [join(root, "home")],
      allowRead: [work],
      allowWrite: [work],
      denyWrite: [join(work, ".git"), join(work, "locked")],
    };
    const run = (command: string) => confined(work, sandbox, command);

    expect((await run("echo x > made && cat made")).output).toBe("x\n");
    expect((await run(`echo x > "${root}/outside"`)).code).not.toBe(0);
    expect((await run("echo x > .git")).code).not.toBe(0);
    expect(await Bun.file(join(work, ".git")).text()).toBe("gitdir: elsewhere\n");
    // A path that may not be written stays unwritten when it does not exist yet, too.
    expect((await run("echo x > locked")).code).not.toBe(0);
    expect(
      await Bun.file(join(work, "locked"))
        .text()
        .catch(() => ""),
    ).toBe("");
    expect((await run(`cat "${root}/home/api.token"`)).code).not.toBe(0);
    expect((await run("cat /etc/hosts")).code).toBe(0);
    // Node resolves a script's path through every directory above it, the denied home included.
    expect((await run("echo 'console.log(1)' > s.js && node s.js")).output).toBe("1\n");
    expect((await run(`ls "${root}/home" 2>&1`)).output).not.toContain("api.token");
    const temp = await run('echo x > "$TMPDIR/t" && echo "$TMPDIR"');
    expect(temp.code).toBe(0);
    expect(temp.output).not.toContain(root);
  });

  test("reads nothing of a denied directory but its readable paths, and no credential in them", async () => {
    await using dir = await tempDirectory();
    const home = await realpath(dir.path);
    const work = join(home, "work");
    const tool = join(home, ".tool");
    await mkdir(work);
    await Bun.write(join(home, "notes.txt"), "private");
    await Bun.write(join(tool, "bin", "version"), "1.0");
    await Bun.write(join(tool, "credentials"), "token");
    const sandbox = {
      ...empty,
      denyRead: [home],
      allowRead: [work, tool],
      denyReadInside: [join(tool, "credentials")],
      allowWrite: [work],
    };
    const run = (command: string) => confined(work, sandbox, command);

    expect((await run(`cat "${tool}/bin/version"`)).output).toBe("1.0");
    expect((await run(`cat "${home}/notes.txt"`)).code).not.toBe(0);
    expect((await run(`cat "${tool}/credentials"`)).code).not.toBe(0);
    expect((await run("echo x > made && cat made")).output).toBe("x\n");
  });

  test("keeps each writable root in place and takes no root someone could have planted", async () => {
    await using dir = await tempDirectory();
    const root = await realpath(dir.path);
    const work = join(root, "work");
    const secret = join(root, "secret");
    const shared = join(root, "shared");
    await mkdir(work);
    await mkdir(secret);
    await mkdir(shared);
    await chmod(shared, 0o1777);
    await symlink(secret, join(shared, "planted"));
    const sandbox = {
      ...empty,
      allowWrite: [work, join(shared, "planted"), join(shared, "made"), join(root, "missing")],
    };
    const run = (command: string) => confined(root, sandbox, command);

    expect((await run(`echo x > "${work}/a" && rm -rf "${work}"`)).code).not.toBe(0);
    expect(await Bun.file(join(work, "a")).exists()).toBe(false);
    expect((await run(`mv "${work}" "${root}/moved"`)).code).not.toBe(0);
    expect((await stat(work)).isDirectory()).toBe(true);
    expect((await run(`echo x > "${shared}/planted/b"`)).code).not.toBe(0);
    expect(await Bun.file(join(secret, "b")).exists()).toBe(false);
    expect((await run(`echo x > "${shared}/made/c"`)).code).toBe(0);
    expect((await lstat(join(shared, "made"))).isDirectory()).toBe(true);
    expect((await run(`mkdir "${root}/missing"`)).code).not.toBe(0);
    // pnpm sets the mode of its lock directories, and only those roots take a new mode.
    const [lock = ""] = packageLocks;
    const locked = { ...empty, allowWrite: [work, lock] };
    expect((await confined(root, locked, `chmod 700 "${lock}"`)).code).toBe(0);
    if (process.platform === "darwin")
      expect((await confined(root, locked, `chmod 700 "${work}"`)).code).not.toBe(0);
  });

  test("reaches no Unix socket outside its writable roots", async () => {
    await using dir = await tempDirectory();
    const root = await realpath(dir.path);
    const work = join(root, "work");
    await mkdir(work);
    const socket = join(root, "engine.sock");
    const server = Bun.listen({ unix: socket, socket: { data() {} } });
    try {
      const reach = `bun -e 'require("net").connect("${socket}").on("connect", () => { console.log("reached"); process.exit(0) }).on("error", () => { console.log("refused"); process.exit(0) })'`;
      expect((await confined(work, { ...empty, allowWrite: [work] }, reach)).output).toBe(
        "refused\n",
      );
    } finally {
      server.stop(true);
    }
  });

  test("reaches only this machine unless the network is open", async () => {
    await using dir = await tempDirectory();
    const work = await realpath(dir.path);
    // The sandbox refuses a connection at once, or has no route on Linux; outside it, TEST-NET-1
    // never answers.
    const outbound = `bun -e 'const s = require("net").connect(80, "192.0.2.1"); s.on("error", (e) => { console.log(e.code); process.exit(0) }); setTimeout(() => { console.log("waited"); process.exit(0) }, 1500)'`;
    const local = { ...empty, allowWrite: [work] };
    expect((await confined(work, local, outbound)).output).toMatch(
      /^(ECONNREFUSED|ENETUNREACH)\n$/,
    );
    expect((await confined(work, { ...local, network: "any" }, outbound)).output).toBe("waited\n");
    const server = `bun -e 'const s = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("up") }); console.log(await (await fetch(s.url)).text()); s.stop()'`;
    expect((await confined(work, local, server)).output).toBe("up\n");
  });

  test("reaches the worktree's ports this machine listens on and serves on the others", async () => {
    await using dir = await tempDirectory();
    const work = await realpath(dir.path);
    const local = { ...empty, allowWrite: [work] };
    const host = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("host") });
    const probe = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
    const free = probe.port;
    probe.stop(true);
    try {
      const env = {
        ...(process.env as Record<string, string>),
        KOZO_PORTS: `${host.port} ${free}`,
      };
      const reach = `bun -e 'console.log(await (await fetch("http://127.0.0.1:${host.port}")).text())'`;
      expect((await confined(work, local, reach, env)).output).toBe("host\n");
      const serve = `bun -e 'const s = Bun.serve({ port: ${free}, hostname: "127.0.0.1", fetch: () => new Response("own") }); console.log(await (await fetch(s.url)).text()); s.stop()'`;
      expect((await confined(work, local, serve, env)).output).toBe("own\n");
      if (process.platform !== "linux") return;
      // The relay outside the sandbox finds no tool in the worktree, even on a relative PATH entry.
      const marker = join(work, "..", `${basename(work)}-escaped`);
      await Bun.write(join(work, "grep"), `#!/bin/sh\ntouch '${marker}'\nexit 1\n`);
      await chmod(join(work, "grep"), 0o755);
      const planted = await confined(work, local, reach, { ...env, PATH: `.:${process.env.PATH}` });
      expect(planted.output).toBe("host\n");
      expect(await Bun.file(marker).exists()).toBe(false);
      // Only a relayed port needs socat; without it on kozod's PATH the command says so instead.
      const parent = await realpath(join(work, ".."));
      const tools = join(parent, `${basename(work)}-tools`);
      await mkdir(tools);
      await symlink(Bun.which("grep") ?? "/usr/bin/grep", join(tools, "grep"));
      const path = process.env.PATH;
      process.env.PATH = tools;
      const withoutSocat = bubblewrap(Bun.which("bwrap", { PATH: path }) ?? "bwrap");
      process.env.PATH = path;
      let output = "";
      const code = await runCommand("true", work, (text) => (output += text), env, {
        confine: withoutSocat,
        sandbox: local,
      });
      expect(code).toBe(126);
      expect(output).toContain("install socat");
    } finally {
      host.stop(true);
    }
  });
});
