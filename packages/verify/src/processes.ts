import { realpath } from "node:fs/promises";

/**
 * Stops the processes that started at or after `since` and still run with their working
 * directory inside `dir`, such as servers a verify session left behind: Claude Code's sandbox
 * refuses the session's own kill once the shell that started them has exited. Processes that
 * were already running, such as a human's shell in the worktree, are left alone, and so are
 * this process and its ancestors, whatever their age. Returns the process IDs that were stopped.
 */
export async function stopProcessesIn(dir: string, since: Date): Promise<number[]> {
  const root = await realpath(dir);
  const table = await processTable();
  const elapsed = (Date.now() - since.getTime()) / 1000;
  const spared = new Set<number>();
  for (let pid = process.pid; pid > 1 && !spared.has(pid); pid = table.get(pid)?.parent ?? 0) {
    spared.add(pid);
  }
  const pids = (await workingDirectories())
    .filter(({ cwd }) => cwd === root || cwd.startsWith(`${root}/`))
    .map(({ pid }) => pid)
    .filter(
      (pid) => !spared.has(pid) && (table.get(pid)?.age ?? Number.POSITIVE_INFINITY) <= elapsed,
    );

  for (const pid of pids) signal(pid, "SIGTERM");
  for (let tries = 0; tries < 50 && pids.some(isRunning); tries++) await Bun.sleep(100);
  for (const pid of pids.filter(isRunning)) signal(pid, "SIGKILL");
  return pids;
}

async function workingDirectories() {
  // lsof exits 1 when it cannot inspect some processes; what it could list is still complete.
  const child = Bun.spawn(["lsof", "-nP", "-d", "cwd", "-Fpn"], {
    stdout: "pipe",
    stderr: "ignore",
  });
  const output = await new Response(child.stdout).text();
  await child.exited;
  const found: { pid: number; cwd: string }[] = [];
  let pid = 0;
  for (const line of output.split("\n")) {
    if (line.startsWith("p")) pid = Number(line.slice(1));
    else if (line.startsWith("n") && pid > 0) found.push({ pid, cwd: line.slice(1) });
  }
  return found;
}

/**
 * Each process's parent and age in seconds; the age comes from ps's portable `etime` field,
 * `[[dd-]hh:]mm:ss`, which rounds down, so it is never older than the truth.
 */
async function processTable() {
  const child = Bun.spawn(["ps", "-axo", "pid=,ppid=,etime="], {
    stdout: "pipe",
    stderr: "ignore",
  });
  const output = await new Response(child.stdout).text();
  await child.exited;
  const table = new Map<number, { parent: number; age: number }>();
  for (const line of output.trim().split("\n")) {
    const [pid, parent, etime] = line.trim().split(/\s+/);
    const match = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/.exec(etime ?? "");
    if (!pid || !parent || !match) continue;
    const [, days = "0", hours = "0", minutes = "0", seconds = "0"] = match;
    const age = ((Number(days) * 24 + Number(hours)) * 60 + Number(minutes)) * 60 + Number(seconds);
    table.set(Number(pid), { parent: Number(parent), age });
  }
  return table;
}

function isRunning(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function signal(pid: number, name: NodeJS.Signals) {
  try {
    process.kill(pid, name);
  } catch {
    // The process has already exited.
  }
}
