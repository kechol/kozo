import { realpath } from "node:fs/promises";

export class ProcessError extends Error {}

/** Each running process's parent and start time, keyed by process ID. */
export type ProcessTable = ReadonlyMap<number, { parent: number; started: string }>;

/**
 * Lists the running processes. A process ID together with its start time, as ps prints it,
 * identifies one process, so a reused ID does not pass for the process that held it before.
 */
export async function runningProcesses(): Promise<ProcessTable> {
  const child = Bun.spawn(["ps", "-axo", "pid=,ppid=,lstart="], {
    stdout: "pipe",
    stderr: "ignore",
  });
  const [output, exitCode] = await Promise.all([new Response(child.stdout).text(), child.exited]);
  const table = new Map<number, { parent: number; started: string }>();
  for (const line of output.split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\S.*?)\s*$/.exec(line);
    if (match) table.set(Number(match[1]), { parent: Number(match[2]), started: match[3] ?? "" });
  }
  // A list without this process is incomplete, and anything missing from it would count as new.
  if (exitCode !== 0 || !table.has(process.pid))
    throw new ProcessError("ps could not list the processes");
  return table;
}

/**
 * Stops the processes that run with their working directory inside `dir` and are not in
 * `before`, such as servers a verify session left behind: Claude Code's sandbox refuses the
 * session's own kill once the shell that started them has exited. Processes that were already
 * running, such as a human's shell in the worktree, are in `before` and are left alone, and so
 * are this process and its ancestors in any case. Returns the process IDs that were stopped.
 */
export async function stopProcessesIn(dir: string, before: ProcessTable): Promise<number[]> {
  const root = await realpath(dir);
  const now = await runningProcesses();
  const spared = new Set<number>();
  for (let pid = process.pid; pid > 1 && !spared.has(pid); pid = now.get(pid)?.parent ?? 0) {
    spared.add(pid);
  }
  const existed = (pid: number) => {
    const started = now.get(pid)?.started;
    return started !== undefined && before.get(pid)?.started === started;
  };
  const pids = (await workingDirectories())
    .filter(({ cwd }) => cwd === root || cwd.startsWith(`${root}/`))
    .map(({ pid }) => pid)
    .filter((pid) => !spared.has(pid) && !existed(pid));

  for (const pid of pids) signal(pid, "SIGTERM");
  for (let tries = 0; tries < 50 && pids.some(isRunning); tries++) await Bun.sleep(100);
  for (const pid of pids.filter(isRunning)) signal(pid, "SIGKILL");
  return pids;
}

async function workingDirectories() {
  // lsof runs outside `dir`, since it would otherwise list itself as a new process there. It
  // exits 1 when it cannot inspect some processes; what it could list is still complete.
  const child = Bun.spawn(["lsof", "-nP", "-d", "cwd", "-Fpn"], {
    cwd: "/",
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
  // lsof always lists its own working directory, so an empty list means it did not run.
  if (found.length === 0) throw new ProcessError("lsof could not list working directories");
  return found;
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
