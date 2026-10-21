import { realpath } from "node:fs/promises";

/** The IDs of the processes running now, taken before a session starts. */
export async function runningProcesses(): Promise<Set<number>> {
  const child = Bun.spawn(["ps", "-axo", "pid="], { stdout: "pipe", stderr: "ignore" });
  const output = await new Response(child.stdout).text();
  await child.exited;
  return new Set(
    output
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map(Number),
  );
}

/**
 * Stops the processes that run with their working directory inside `dir` and are not in
 * `before`, such as servers a verify session left behind: Claude Code's sandbox refuses the
 * session's own kill once the shell that started them has exited. Processes that were already
 * running, such as a human's shell in the worktree, this process and its ancestors, are in
 * `before` and are left alone. Returns the process IDs that were stopped.
 */
export async function stopProcessesIn(dir: string, before: ReadonlySet<number>): Promise<number[]> {
  const root = await realpath(dir);
  const pids = (await workingDirectories())
    .filter(({ cwd }) => cwd === root || cwd.startsWith(`${root}/`))
    .map(({ pid }) => pid)
    .filter((pid) => !before.has(pid));

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
