import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, relative } from "node:path";
import type { GateLevel, KozoHome } from "@kozo/core";
import {
  type CommandLimit,
  type Confined,
  commandEnvironmentFrom,
  deniedCredentials,
  git,
  packageCaches,
  packageLocks,
  runCommand,
  runGates,
  worktreeReadable,
} from "@kozo/verify";
import type { EventStore } from "./event-store.ts";
import type { RunnerDeps } from "./runner.ts";
import { worktreeEnvironment } from "./worktree-ports.ts";

/**
 * The environment and sandbox of the commands kozod runs in a worktree: prepare, the gates,
 * prove and codemods, the gates' records included.
 */
export class CommandEnvironment {
  constructor(
    private readonly home: KozoHome,
    private readonly store: EventStore,
    private readonly deps: Pick<RunnerDeps, "confine" | "egress">,
  ) {}

  /** The environment of the diff's own code in prepare, the gates and prove: no credentials. */
  private readonly commandEnv = commandEnvironmentFrom(process.env);

  /**
   * Runs one prepare command in `worktree`'s prepare sandbox, through the egress proxy with a
   * token of its own when kozod runs one, and withdraws the token once the command ends.
   */
  async prepare(
    command: string,
    worktree: string,
    log: (text: string) => void,
    env: Record<string, string>,
    limit?: CommandLimit,
  ): Promise<number> {
    const { egress } = this.deps;
    const confined = this.confined(worktree, true);
    if (egress === undefined) return await runCommand(command, worktree, log, env, confined, limit);
    const { url, revoke } = egress.issue();
    const proxy = {
      HTTPS_PROXY: url,
      HTTP_PROXY: url,
      https_proxy: url,
      http_proxy: url,
      KOZO_EGRESS_PORT: String(egress.port),
    };
    return await runCommand(command, worktree, log, { ...env, ...proxy }, confined, limit).finally(
      revoke,
    );
  }

  async envFor(worktree: string): Promise<Record<string, string>> {
    return { ...this.commandEnv, ...(await worktreeEnvironment(worktree)) };
  }

  /**
   * The sandbox of the commands run in `worktree`: they read neither the factory's home, which
   * holds the API token and every other task, nor anything else in the home directory but the
   * worktree, its repository's git directory and the tools, nor credentials, and write only the
   * worktree, but not the file that ties it to its repository, and pnpm's locks. Only prepare,
   * which installs the base's dependencies before any diff exists, reaches other hosts and
   * writes the package caches.
   */
  confined(worktree: string, prepare = false): Confined {
    const credentials = deniedCredentials(process.env);
    return {
      confine: this.deps.confine,
      sandbox: {
        denyRead: [this.home.root, homedir()],
        allowRead: worktreeReadable(worktree, process.env, [this.home.root, ...credentials]),
        denyReadInside: credentials,
        allowWrite: [worktree, ...packageLocks, ...(prepare ? packageCaches : [])],
        denyWrite: [join(worktree, ".git")],
        network: prepare && this.deps.egress === undefined ? "any" : "local",
      },
    };
  }

  /**
   * Runs the gates of `level` in `cwd` without credentials, keeps their whole output at
   * `outputPath` and records the result with the commit they ran on.
   */
  async recordedGates(
    where: { run_id?: string; item: string; task: string | null; node: string },
    level: GateLevel,
    cwd: string,
    base: string,
    outputPath: string,
    limit?: CommandLimit,
  ) {
    let output = "";
    const result = await runGates({
      cwd,
      level,
      base,
      env: await this.envFor(cwd),
      confined: this.confined(cwd),
      limit,
      log: (text) => {
        output += text;
      },
    });
    const head = (await git(cwd, ["rev-parse", "HEAD"])).trim();
    await mkdir(dirname(outputPath), { recursive: true });
    await Bun.write(outputPath, output);
    const run = { level, head, output_path: relative(this.home.root, outputPath) };
    await this.store.append({
      ...where,
      type: "gates.result",
      data:
        result.status === "pass"
          ? { ...run, status: "pass" }
          : result.status === "fail"
            ? { ...run, status: "fail", failed: result.failed }
            : { ...run, status: "MISCONFIGURED", reason: result.reason },
    });
    return { result, output };
  }
}
