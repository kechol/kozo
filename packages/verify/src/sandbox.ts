import { lstatSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { lstat, mkdir, mkdtemp, realpath, rm, stat } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";

/** What a command confined by kozo may reach beyond the system's own files. */
export interface CommandSandbox {
  /** Paths it may not read; everything else is readable. */
  denyRead: string[];
  /** Paths inside the denied ones that it may read, such as a worktree in the factory's home. */
  allowRead: string[];
  /** Paths inside the readable ones that it may not read, such as a credential of a tool. */
  denyReadInside: string[];
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
  ".cargo/credentials",
  ".cargo/credentials.toml",
];

export function deniedCredentials(env: Record<string, string | undefined>): string[] {
  const xdg = env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
  // Each path with where its links lead, for a sandbox that matches paths as given.
  return [
    ...new Set(
      [
        ...[...credentialPaths, ".config/git/credentials"].map((path) => join(homedir(), path)),
        join(xdg, "gh"),
        join(xdg, "git", "credentials"),
        ...(env.CLAUDE_CONFIG_DIR ? [env.CLAUDE_CONFIG_DIR] : []),
      ].flatMap((path) => withTargets(path)),
    ),
  ];
}

/**
 * The package managers' download caches in the home directory, which prepare writes so that an
 * install reuses what earlier tasks and the human downloaded. The gates and prove only read them.
 */
const cachePaths = [
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
];
export const packageCaches = cachePaths.map((path) => join(homedir(), path));

// Directories in the home directory that hold the directories of many tools rather than being
// one tool's own.
const homeContainers = [".local", ".local/share", ".local/state", ".config", "Library"];

// What the tools read of their own configuration in the home directory.
const toolConfiguration = [
  ".gitconfig",
  ".config/git",
  ".config/mise",
  ".tool-versions",
  ".rustup",
  "Library/Caches/mise",
];

/**
 * `path` with where its links lead: the path's own target, through a linked directory above it
 * too, and, for a directory, the targets of the links directly inside it. A sandbox reads a file
 * at the end of its links, Claude Code's without resolving the paths it is given, and a home's
 * configuration is often a tree of links into dotfiles.
 */
function withTargets(path: string, follow: (entry: string) => boolean = () => true): string[] {
  const real = (target: string) => {
    try {
      return realpathSync(target);
    } catch {
      return null;
    }
  };
  const own = real(path);
  let inside: string[] = [];
  try {
    inside = readdirSync(path)
      .map((name) => join(path, name))
      .filter((entry) => follow(entry) && lstatSync(entry).isSymbolicLink())
      .flatMap((entry) => real(entry) ?? []);
  } catch {}
  return [...new Set([path, ...(own && own !== path ? [own] : []), ...inside])];
}

/**
 * What a confined command may read in the home directory, which it otherwise may not: the package
 * caches, the tools' configuration and, for each entry of `env.PATH` in the home directory, the
 * tool's directory that holds it, the first one below the home directory or below a directory
 * that holds many tools, such as `.local/share/mise` for `.local/share/mise/shims`.
 */
export function homeReadable(
  env: Record<string, string | undefined>,
  denied: readonly string[] = [],
  home = homedir(),
): string[] {
  const caches = cachePaths.map((path) => join(home, path));
  const tools = (env.PATH ?? "").split(":").flatMap((entry) => {
    const parts = relative(home, entry).split("/");
    if (!entry.startsWith("/") || parts[0] === "" || parts[0] === "..") return [];
    let depth = 1;
    while (depth < parts.length && homeContainers.includes(parts.slice(0, depth).join("/")))
      depth += 1;
    return [join(home, ...parts.slice(0, depth))];
  });
  const within = (path: string, root: string) => path === root || path.startsWith(`${root}/`);
  // A confined command writes the caches and the locks, so a link there could have been planted
  // by one, and the next one would read where it leads: links are followed only elsewhere, and
  // never to the home directory itself or above it, nor into or around a denied path.
  const writable = [...caches, ...packageLocks];
  const safe = (target: string) =>
    !within(home, target) && !denied.some((path) => within(target, path) || within(path, target));
  const followed = [...toolConfiguration.map((path) => join(home, path)), ...tools].flatMap(
    (path) =>
      writable.some((root) => within(path, root))
        ? [path]
        : withTargets(
            path,
            (entry) => !writable.some((root) => within(root, entry) || within(entry, root)),
          ).filter((target) => target === path || safe(target)),
  );
  return [...new Set([...caches, ...followed])];
}

/**
 * The git directory that `worktree` shares with its repository, which git in the worktree reads,
 * or nothing when its `.git` does not link to one.
 */
export function sharedGitDirectory(worktree: string): string[] {
  try {
    const link = readFileSync(join(worktree, ".git"), "utf8").match(/^gitdir: (.+)$/m)?.[1];
    if (!link) return [];
    const gitDir = resolve(worktree, link.trim());
    return [resolve(gitDir, readFileSync(join(gitDir, "commondir"), "utf8").trim())];
  } catch {
    return [];
  }
}

/**
 * What a command or a shell confined to `worktree` reads in the home directory, which it may not
 * read otherwise: the worktree, the git directory it shares with its repository, and the paths
 * of `homeReadable`.
 */
export function worktreeReadable(
  worktree: string,
  env: Record<string, string | undefined>,
  denied: readonly string[] = [],
): string[] {
  return [worktree, ...sharedGitDirectory(worktree), ...homeReadable(env, denied)];
}

/**
 * The lock directories pnpm keeps in /tmp whatever TMPDIR says, which every pnpm command takes,
 * `pnpm run` included, so every confined command may write them.
 */
export const packageLocks = [
  "pnpm-dir-locks",
  "pnpm-store-operation-locks",
  "pnpm-verify-deps-install-locks",
].map(
  (name) =>
    `${process.platform === "darwin" ? "/private/tmp" : "/tmp"}/${name}-${process.getuid?.() ?? 0}`,
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
    // A denied directory keeps the metadata of what is in it, so that a tool looking for an
    // optional file there finds none rather than failing. Seatbelt prefers a rule that names an
    // operation over one with a wildcard, so the read rules name the same operations throughout.
    ...rule("deny file-read-data file-read-xattr", sandbox.denyRead),
    ...rule("allow file-read-data file-read-xattr file-read-metadata", sandbox.allowRead),
    // Resolving a path inside a denied directory looks at each directory on the way.
    ...ancestors(sandbox.allowRead).map(
      (path) => `(allow file-read-metadata (literal ${quoted(path)}))`,
    ),
    ...rule("deny file-read-data file-read-xattr file-read-metadata", sandbox.denyReadInside),
    ...rule("allow file-write*", sandbox.allowWrite),
    // A writable root itself may not be removed, renamed or replaced, by a link to anywhere, say,
    // which the next run would resolve and then allow.
    ...sandbox.allowWrite.map((path) => `(deny file-write* (literal ${quoted(path)}))`),
    // pnpm sets the mode of each lock directory it takes, which moves nothing a later run resolves.
    ...sandbox.allowWrite
      .filter((path) => packageLocks.includes(path))
      .map((path) => `(allow file-write-mode (literal ${quoted(path)}))`),
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

/**
 * The bubblewrap arguments of `sandbox` on Linux: the whole system read-only, each denied path
 * hidden under an empty directory or /dev/null, the readable and writable ones mounted again on
 * top, the paths inside them that may not be read hidden once more, and the paths inside them
 * that may not be written read-only once more, made as empty
 * files first when they do not exist so that the command cannot make them. Later mounts cover
 * earlier ones, so the order is that of the lists; a writable root is a mount point, which the
 * command cannot remove, rename or replace. A `local` command gets a network of its own, whose
 * loopback is all it reaches, and empty /run and /tmp, so that no Unix socket outside its
 * writable roots is in reach, as in Seatbelt; prepare keeps /run, which holds the resolver's
 * configuration on many systems, with the user's runtime directory and the system's sockets
 * hidden.
 */
export function bubblewrapArgs(sandbox: CommandSandbox): string[] {
  const kind = (path: string) => {
    try {
      return statSync(path).isDirectory() ? "directory" : "file";
    } catch {
      return null;
    }
  };
  const hide = (path: string) => {
    const found = kind(path);
    if (found === "directory") return ["--tmpfs", path];
    if (found === "file") return ["--ro-bind", "/dev/null", path];
    return [];
  };
  const mount = (flag: string, path: string) => (kind(path) ? [flag, path, path] : []);
  const local = sandbox.network === "local";
  const runtime = process.env.XDG_RUNTIME_DIR ?? `/run/user/${process.getuid?.() ?? 0}`;
  // The known sockets are hidden in either case, since the runtime directory need not be under
  // /run, nor /var/run a link to it.
  const known = [
    runtime,
    "/run/docker.sock",
    "/run/dbus",
    "/var/run/docker.sock",
    "/tmp/.X11-unix",
  ];
  const sockets = local ? ["/run", "/tmp", ...known] : known;
  const hidden = [...sockets, ...sandbox.denyRead];
  // Each empty directory is made read-only once everything is mounted on it.
  const covered = [...hidden, ...sandbox.denyReadInside].filter(
    (path) => kind(path) === "directory",
  );
  return [
    "--die-with-parent",
    "--new-session",
    "--unshare-pid",
    "--unshare-ipc",
    "--unshare-uts",
    ...(local ? ["--unshare-net"] : []),
    "--ro-bind",
    "/",
    "/",
    "--dev",
    "/dev",
    "--proc",
    "/proc",
    ...hidden.flatMap(hide),
    ...sandbox.allowRead.flatMap((path) => mount("--ro-bind", path)),
    ...sandbox.allowWrite.flatMap((path) => mount("--bind", path)),
    ...sandbox.denyReadInside.flatMap(hide),
    // bubblewrap makes the mount point of a missing path, an empty file, before binding on it.
    ...sandbox.denyWrite.flatMap((path) =>
      kind(path) ? ["--ro-bind", path, path] : ["--ro-bind", "/dev/null", path],
    ),
    ...covered.flatMap((path) => ["--remount-ro", path]),
  ];
}

// Outside bubblewrap: relays each port of the worktree that this machine listens on to a Unix
// socket in the command's TMPDIR, which bubblewrap mounts, and names the relayed ports to the
// inside. A port nobody listens on is left to the command, which may serve on it itself. The
// relays are quiet, since stopping them makes socat warn; a failed connection reaches the
// command as one. The script runs outside the sandbox in the worktree, so it finds its tools only
// on the absolute directories of kozod's PATH, never on a relative entry that the diff could
// fill, and gives the command its own PATH back.
const relayOutside = (path: string) => `original=$PATH
PATH='${path.replaceAll("'", `'\\''`)}'
ports=
for port in $KOZO_PORTS $KOZO_EGRESS_PORT; do
  hex=$(printf %04X "$port")
  if grep -qs ":$hex [0-9A-F]*:0000 0A" /proc/net/tcp /proc/net/tcp6; then ports="$ports $port"; fi
done
export KOZO_RELAYED="$ports" KOZO_RELAY="$TMPDIR/kozo-relay"
if [ -z "$ports" ]; then
  export PATH="$original"
  exec "$@"
fi
if ! command -v socat >/dev/null; then
  echo "kozo: install socat, which the sandbox needs to reach ports$ports on this machine" >&2
  exit 126
fi
mkdir -m 700 "$KOZO_RELAY" || exit 126
pids=
trap 'kill $pids 2>/dev/null' EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
for port in $ports; do
  socat UNIX-LISTEN:"$KOZO_RELAY/$port",fork TCP4:127.0.0.1:"$port" 2>/dev/null &
  pid=$!
  pids="$pids $pid"
  until [ -S "$KOZO_RELAY/$port" ]; do kill -0 "$pid" 2>/dev/null || exit 126; sleep 0.01; done
done
PATH=$original "$@"`;

// Inside bubblewrap: listens on each relayed port of the command's own loopback, once ready, with
// the same tools as outside, so that a file of the diff cannot hold the command up.
const relayInside = (path: string) => `original=$PATH
PATH='${path.replaceAll("'", `'\\''`)}'
for port in $KOZO_RELAYED; do
  socat TCP4-LISTEN:"$port",bind=127.0.0.1,fork,reuseaddr UNIX-CONNECT:"$KOZO_RELAY/$port" &
  pid=$!
  socat "TCP6-LISTEN:$port,bind=[::1],fork,reuseaddr" "UNIX-CONNECT:$KOZO_RELAY/$port" 2>/dev/null &
  hex=$(printf %04X "$port")
  until grep -qs ":$hex [0-9A-F]*:0000 0A" /proc/net/tcp; do kill -0 "$pid" 2>/dev/null || exit 126; sleep 0.01; done
done
unset KOZO_RELAYED KOZO_RELAY
export PATH="$original"
exec "$@"`;

/**
 * Confines a command with bubblewrap, found on PATH, Linux's sandbox without privileges. A
 * `local` command reaches the ports of `KOZO_PORTS`, and kozod's egress proxy at
 * `KOZO_EGRESS_PORT`, that this machine listens on when it
 * starts, such as a database its services started, through socat.
 */
export function bubblewrap(bwrap: string): Confine {
  const path = (process.env.PATH ?? "")
    .split(":")
    .filter((entry) => entry.startsWith("/"))
    .join(":");
  return (sandbox, argv) => {
    const confined = [bwrap, ...bubblewrapArgs(sandbox), "--"];
    if (sandbox.network !== "local") return [...confined, ...argv];
    const relay = (script: string) => ["/bin/sh", "-c", script, "kozo-relay"];
    return [...relay(relayOutside(path)), ...confined, ...relay(relayInside(path)), ...argv];
  };
}

/** This machine's way to confine a command, or why there is none. */
export async function platformConfine(): Promise<Confine> {
  const empty: CommandSandbox = {
    denyRead: [],
    allowRead: [],
    denyReadInside: [],
    allowWrite: [],
    denyWrite: [],
    network: "local",
  };
  const probe = async (confine: Confine, name: string) => {
    const child = Bun.spawn(confine(empty, ["/bin/sh", "-c", "true"]), {
      stdin: "ignore",
      stdout: "ignore",
      stderr: "pipe",
    });
    const [stderr, code] = await Promise.all([new Response(child.stderr).text(), child.exited]);
    if (code !== 0) throw new SandboxUnavailable(`${name} does not run: ${stderr.trim()}`);
    return confine;
  };
  if (process.platform === "darwin") return await probe(seatbelt, "sandbox-exec");
  if (process.platform === "linux") {
    const bwrap = Bun.which("bwrap");
    if (!bwrap)
      throw new SandboxUnavailable("bubblewrap is not installed; install the bwrap command");
    return await probe(bubblewrap(bwrap), "bwrap");
  }
  throw new SandboxUnavailable(`kozo has no sandbox for ${process.platform}`);
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
        denyReadInside: await resolve(sandbox.denyReadInside),
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
