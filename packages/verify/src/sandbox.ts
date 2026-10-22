import { lstat, mkdir, mkdtemp, realpath, rm, stat } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";

/** What a command confined by kozo may reach beyond the system's own files. */
export interface CommandSandbox {
  /** Paths it may not read; everything else is readable. */
  denyRead: string[];
  /** Paths inside the denied ones that it may read, such as a worktree in the factory's home. */
  allowRead: string[];
  /** The only paths it may write, besides its own temporary directory. */
  allowWrite: string[];
  /** Paths inside the writable ones that it may not write. */
  denyWrite: string[];
  /** `local` reaches only this machine; `any` reaches every host, for installing dependencies. */
  network: "local" | "any";
}

/** Turns a command line into one that runs it confined to `sandbox`. */
export type Confine = (sandbox: CommandSandbox, argv: string[]) => string[];

export class SandboxUnavailable extends Error {}

/**
 * Credential paths no confined command reads: the usual ones under the home directory, gh and
 * git under XDG_CONFIG_HOME, and Claude Code's own configuration directory.
 */
export const credentialPaths = [
  ".ssh",
  ".aws",
  ".gnupg",
  ".config/gh",
  ".config/gcloud",
  ".kube",
  ".docker",
  ".npmrc",
  ".pypirc",
  ".git-credentials",
  ".netrc",
  ".claude",
  "Library/Keychains",
];

export function deniedCredentials(env: Record<string, string | undefined>): string[] {
  const xdg = env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
  return [
    ...[...credentialPaths, ".config/git/credentials"].map((path) => join(homedir(), path)),
    join(xdg, "gh"),
    join(xdg, "git", "credentials"),
    ...(env.CLAUDE_CONFIG_DIR ? [env.CLAUDE_CONFIG_DIR] : []),
  ];
}

/**
 * The package managers' download caches in the home directory, which prepare writes so that an
 * install reuses what earlier tasks and the human downloaded. The gates and prove only read them.
 */
export const packageCaches = [
  ".npm",
  ".cache",
  ".bun/install/cache",
  ".yarn/berry/cache",
  "Library/pnpm",
  "Library/Caches/pnpm",
  "Library/Caches/Yarn",
  "Library/Caches/ms-playwright",
  "Library/Caches/pip",
  ".cargo/registry",
  "go/pkg/mod",
].map((path) => join(homedir(), path));

/**
 * The lock directories pnpm keeps in /tmp whatever TMPDIR says, which every pnpm command takes,
 * `pnpm run` included, so every confined command may write them.
 */
export const packageLocks = ["pnpm-dir-locks", "pnpm-store-operation-locks"].map(
  (name) => `/private/tmp/${name}-${process.getuid?.() ?? 0}`,
);

const quoted = (path: string) => `"${path.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;

/** One rule over `paths` as subpaths, or nothing for no paths, which would match everything. */
const rule = (action: string, paths: readonly string[]) =>
  paths.length === 0
    ? []
    : [`(${action} ${paths.map((path) => `(subpath ${quoted(path)})`).join(" ")})`];

/** The directories above `paths`, each once, without the root. */
const ancestors = (paths: readonly string[]) => [
  ...new Set(
    paths.flatMap((path) => {
      const above: string[] = [];
      for (let dir = dirname(path); dir !== dirname(dir); dir = dirname(dir)) above.push(dir);
      return above;
    }),
  ),
];

/**
 * The macOS Seatbelt profile of `sandbox`. Everything is denied unless allowed, and a later rule
 * wins over an earlier one, so each list narrows the one before it. Paths must be real paths,
 * since Seatbelt matches the path a symbolic link resolves to.
 */
export function seatbeltProfile(sandbox: CommandSandbox): string {
  const network =
    sandbox.network === "any"
      ? ["(allow network*)"]
      : [
          '(allow network-outbound (remote ip "localhost:*"))',
          '(allow network-bind network-inbound (local ip "localhost:*"))',
          // Unix sockets only where the command may write, which keeps Docker's socket out of reach.
          ...sandbox.allowWrite.flatMap((path) => [
            `(allow network-bind network-inbound (local unix-socket (subpath ${quoted(path)})))`,
            `(allow network-outbound (remote unix-socket (subpath ${quoted(path)})))`,
          ]),
        ];
  return [
    "(version 1)",
    "(deny default)",
    '(import "system.sb")',
    "(allow process-fork process-exec)",
    "(allow signal (target same-sandbox))",
    "(allow sysctl-read pseudo-tty ipc-posix-shm ipc-posix-sem)",
    "(allow file-read*)",
    ...rule("deny file-read*", sandbox.denyRead),
    ...rule("allow file-read*", sandbox.allowRead),
    // Resolving a path inside a denied directory looks at each directory on the way.
    ...ancestors(sandbox.allowRead).map(
      (path) => `(allow file-read-metadata (literal ${quoted(path)}))`,
    ),
    ...rule("allow file-write*", sandbox.allowWrite),
    // A writable root itself may not be removed, renamed or replaced, by a link to anywhere, say,
    // which the next run would resolve and then allow.
    ...sandbox.allowWrite.map((path) => `(deny file-write* (literal ${quoted(path)}))`),
    '(allow file-write* file-ioctl (literal "/dev/null") (literal "/dev/tty") (regex #"^/dev/fd/"))',
    ...rule("deny file-write*", sandbox.denyWrite),
    ...network,
    // Chromium registers a service for its child processes, which look it up; nothing else may.
    '(allow mach-register mach-lookup (global-name-prefix "org.chromium.Chromium.MachPortRendezvousServer."))',
    '(allow iokit-open-user-client (iokit-user-client-class "RootDomainUserClient"))',
    "",
  ].join("\n");
}

const sandboxExec = "/usr/bin/sandbox-exec";

/** Confines a command with Seatbelt through `sandbox-exec`, macOS's only way to do so. */
export const seatbelt: Confine = (sandbox, argv) => [
  sandboxExec,
  "-p",
  seatbeltProfile(sandbox),
  ...argv,
];

/** This machine's way to confine a command, or why there is none. */
export async function platformConfine(): Promise<Confine> {
  if (process.platform !== "darwin") {
    throw new SandboxUnavailable(`kozo has no sandbox for ${process.platform} yet`);
  }
  const probe = Bun.spawn(
    seatbelt({ denyRead: [], allowRead: [], allowWrite: [], denyWrite: [], network: "local" }, [
      "/usr/bin/true",
    ]),
    { stdin: "ignore", stdout: "ignore", stderr: "pipe" },
  );
  const [stderr, code] = await Promise.all([new Response(probe.stderr).text(), probe.exited]);
  if (code !== 0) throw new SandboxUnavailable(`sandbox-exec does not run: ${stderr.trim()}`);
  return seatbelt;
}

/** `path` with symbolic links resolved, or as given when it does not exist. */
const real = (path: string) => realpath(path).catch(() => path);

/**
 * The roots of `paths` a command may write, as real paths. One that does not exist is left out,
 * since the command could otherwise make it a link to anywhere. In a directory everyone may
 * write, such as /tmp, kozod makes the root itself first, and it counts only as a directory of
 * this user, never a link that someone else put there.
 */
async function writableRoots(paths: readonly string[]): Promise<string[]> {
  const roots: string[] = [];
  for (const path of paths) {
    const parent = await stat(dirname(path)).catch(() => null);
    if (parent && (parent.mode & 0o002) !== 0) {
      await mkdir(path, { mode: 0o700 }).catch(() => {});
      const entry = await lstat(path).catch(() => null);
      if (entry?.isDirectory() && entry.uid === process.getuid?.()) roots.push(path);
      continue;
    }
    const resolved = await realpath(path).catch(() => null);
    if (resolved !== null) roots.push(resolved);
  }
  return roots;
}

/**
 * Runs `run` with a new temporary directory and `sandbox` resolved to real paths, the directory
 * among the writable ones, and removes the directory afterwards. The directory sits in the
 * system's per-user temporary directory, whose short path leaves room for Unix socket names.
 */
export async function withSandboxTemp<T>(
  sandbox: CommandSandbox,
  run: (sandbox: CommandSandbox, temp: string) => Promise<T>,
): Promise<T> {
  const temp = await realpath(await mkdtemp(join(tmpdir(), "kozo-")));
  try {
    const resolve = (paths: string[]) => Promise.all(paths.map(real));
    return await run(
      {
        denyRead: await resolve(sandbox.denyRead),
        allowRead: await resolve(sandbox.allowRead),
        allowWrite: [...(await writableRoots(sandbox.allowWrite)), temp],
        denyWrite: await resolve(sandbox.denyWrite),
        network: sandbox.network,
      },
      temp,
    );
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}
