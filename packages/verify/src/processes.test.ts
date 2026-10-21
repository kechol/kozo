import { describe, expect, test } from "bun:test";
import { tempDirectory } from "@kozo/testing";
import { runningProcesses, stopProcessesIn } from "./processes.ts";

function sleeper(cwd: string) {
  return Bun.spawn(["sleep", "60"], { cwd, stdout: "ignore", stderr: "ignore" });
}

/** Waits until lsof lists `pid` with a working directory, so a loaded machine cannot race it. */
async function listed(pid: number) {
  for (let tries = 0; tries < 50; tries++) {
    const child = Bun.spawn(["lsof", "-a", "-p", String(pid), "-d", "cwd", "-Fn"], {
      stdout: "pipe",
    });
    if ((await new Response(child.stdout).text()).includes("\nn")) return;
    await Bun.sleep(20);
  }
}

describe("stopProcessesIn", () => {
  test("spares this process's ancestors even when they run in the directory", async () => {
    await using dir = await tempDirectory();
    const script = `${dir.path}/stop.ts`;
    await Bun.write(
      script,
      `import { runningProcesses, stopProcessesIn } from ${JSON.stringify(`${import.meta.dir}/processes.ts`)};\n` +
        "console.log(JSON.stringify(await stopProcessesIn(process.cwd(), await runningProcesses())));\n",
    );
    // A shell in the directory starts the script, as a human's terminal or a tool would.
    const shell = Bun.spawn(
      ["sh", "-c", `"${process.execPath}" run stop.ts; echo shell-survived`],
      {
        cwd: dir.path,
        stdout: "pipe",
      },
    );
    const output = await new Response(shell.stdout).text();
    expect(output).toContain("[]");
    expect(output).toContain("shell-survived");
  });

  test("stops processes started in the directory after the snapshot", async () => {
    await using dir = await tempDirectory({ "sub/.keep": "" });
    await using elsewhere = await tempDirectory();
    const before = await runningProcesses();
    const inside = sleeper(`${dir.path}/sub`);
    const outside = sleeper(elsewhere.path);
    await listed(inside.pid);
    try {
      const stopped = await stopProcessesIn(dir.path, before);
      expect(stopped).toEqual([inside.pid]);
      expect(await inside.exited).not.toBe(0);
      expect(outside.exitCode).toBeNull();
    } finally {
      inside.kill();
      outside.kill();
    }
  });

  test("leaves processes that were already running", async () => {
    await using dir = await tempDirectory();
    const earlier = sleeper(dir.path);
    try {
      await listed(earlier.pid);
      expect(await stopProcessesIn(dir.path, await runningProcesses())).toEqual([]);
      expect(earlier.exitCode).toBeNull();
    } finally {
      earlier.kill();
    }
  });
});
