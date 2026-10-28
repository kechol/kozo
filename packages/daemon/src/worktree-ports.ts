import { basename } from "node:path";

/** Where kozod keeps a worktree's ports: beside it, not in it, to keep it clean. */
const portsFile = (worktree: string) => `${worktree}.ports`;

/** The ports this kozod has handed to worktrees, which it hands to no other. */
const handedOut = new Set<number>();

/**
 * Takes `count` free ports for a worktree once and keeps them for its life, so that the services
 * it started and its checks agree on them in every run. Each port is held open until the file
 * names it, and none goes to two worktrees of this kozod, however many prepare at once.
 */
export async function takePorts(worktree: string, count: number): Promise<number[]> {
  const kept = await readPorts(worktree);
  for (const port of kept) handedOut.add(port);
  if (kept.length >= count) return kept;
  const ports = [...kept];
  const listeners: { stop(closeActive?: boolean): void }[] = [];
  try {
    while (ports.length < count) {
      const listener = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
      listeners.push(listener);
      if (handedOut.has(listener.port)) continue;
      handedOut.add(listener.port);
      ports.push(listener.port);
    }
    await Bun.write(portsFile(worktree), `${JSON.stringify(ports)}\n`);
  } finally {
    for (const listener of listeners) listener.stop(true);
  }
  return ports;
}

async function readPorts(worktree: string): Promise<number[]> {
  const kept = await Bun.file(portsFile(worktree))
    .json()
    .catch(() => []);
  return Array.isArray(kept) ? kept.filter((port) => Number.isInteger(port)) : [];
}

/**
 * What a worktree's commands learn of it: `KOZO_TASK_ID`, a name unique to the worktree that
 * suits a container project, and its ports as `KOZO_PORT_1` and on and `KOZO_PORTS`.
 */
export async function worktreeEnvironment(worktree: string): Promise<Record<string, string>> {
  const ports = await readPorts(worktree);
  const id = basename(worktree)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return {
    KOZO_TASK_ID: id,
    ...(ports.length > 0 ? { KOZO_PORTS: ports.join(" ") } : {}),
    ...Object.fromEntries(ports.map((port, index) => [`KOZO_PORT_${index + 1}`, String(port)])),
  };
}
