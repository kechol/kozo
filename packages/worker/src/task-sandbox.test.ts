import { describe, expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { kozoHome } from "@kozo/core";
import { gitRepository, tempDirectory } from "@kozo/testing";
import { claudeAgent } from "./claude-agent.ts";
import type { AgentRecord } from "./coding-agent.ts";
import { factoryGitEnvironment } from "./git-environment.ts";
import { taskSandbox } from "./task-sandbox.ts";

/**
 * A repository with a task worktree. The live test puts the repository outside the temporary
 * directory, because the sandbox always lets the shell write there.
 */
async function taskWorktree(outsideTemp = false) {
  const repo = await gitRepository(
    outsideTemp ? join(import.meta.dir, "..", "..", "..", ".output", "sandbox-test") : undefined,
  );
  const main = await repo.commit({ "README.md": "# shop\n" }, "start");
  const dir = await tempDirectory();
  const home = kozoHome(dir.path);
  await mkdir(home.worktrees, { recursive: true });
  const worktree = join(home.worktrees, "shop-K-1-t1");
  await repo.git("worktree", "add", "--quiet", "-b", "kozo/k3x9q2/K-1-t1", worktree, "main");
  await Bun.write(home.apiToken, "secret-token-value\n");
  return {
    repo,
    main,
    home,
    worktree,
    async [Symbol.asyncDispose]() {
      await dir[Symbol.asyncDispose]();
      await repo[Symbol.asyncDispose]();
    },
  };
}

describe("taskSandbox", () => {
  test("lets the shell write only the shared git directory's objects, kozo refs and the worktree's metadata", async () => {
    await using task = await taskWorktree();
    await task.repo.git("branch", "human-work", "main");
    await Bun.write(join(task.worktree, "src", "cart.test.ts"), "test\n");
    const paths = await taskSandbox(task.home, task.worktree, "kozo/k3x9q2/K-1-t1", {
      writable: true,
      protectedPaths: [".kozo/**", "src/*.test.ts", "app/[id]"],
      existingTests: ["src/cart.test.ts"],
    });
    const common = await task.repo.git("rev-parse", "--path-format=absolute", "--git-common-dir");
    expect(paths.denyRead).toEqual([task.home.root]);
    expect(paths.allowRead).toEqual([task.worktree]);
    expect(paths.allowWrite).toEqual([
      join(common, "objects"),
      join(common, "refs", "heads", "kozo"),
      join(common, "logs", "refs", "heads", "kozo"),
      join(common, "worktrees", "shop-K-1-t1"),
    ]);
    expect(paths.denyWrite).toContain(join(task.worktree, ".git"));
    expect(paths.denyWrite).toContain(join(common, "refs", "heads", "main"));
    expect(paths.denyWrite).toContain(join(common, "refs", "heads", "human-work"));
    expect(paths.denyWrite).not.toContain(
      join(common, "refs", "heads", "kozo", "k3x9q2", "K-1-t1"),
    );
    expect(paths.denyWrite).toContain(join(task.worktree, ".kozo"));
    expect(paths.denyWrite).toContain(join(task.worktree, "app", "[id]"));
    expect(paths.denyWrite).toContain(join(task.worktree, "src", "cart.test.ts"));
    const reading = await taskSandbox(task.home, task.worktree, "kozo/k3x9q2/K-1-t1", {
      writable: false,
    });
    expect(reading.allowWrite).toEqual([]);
    expect(reading.denyWrite).toContain(task.worktree);
  });

  const claude = Bun.which("claude");
  test.skipIf(process.env.KOZO_LIVE !== "1" || !claude)(
    "in a live session the shell commits on the task branch but cannot move main or read the home",
    async () => {
      await using task = await taskWorktree(true);
      const records: AgentRecord[] = [];
      const outcome = await claudeAgent(claude ?? "").run({
        agent: "implement",
        model: "claude-haiku-5-5",
        cwd: task.worktree,
        instructions:
          "Run each command you are given with Bash, one call per command, and report every output.",
        prompt: [
          "Run these four commands, each in its own Bash call, even if one fails:",
          "1. `echo fix > fix.txt && git add fix.txt && git commit -m fix`",
          "2. `git update-ref refs/heads/main HEAD`",
          `3. \`cat ${task.home.apiToken}\``,
          "4. `git config core.hooksPath /tmp`",
          'Then answer with "done".',
        ].join("\n"),
        outputSchema: {
          type: "object",
          properties: { word: { type: "string" } },
          required: ["word"],
          additionalProperties: false,
        },
        maxTurns: 12,
        maxCostUsd: 0.5,
        pendingInstructions: async () => [],
        record: (record) => records.push(record),
        signal: new AbortController().signal,
        env: factoryGitEnvironment,
        guard: async () => ({ allow: true }),
        sandbox: await taskSandbox(task.home, task.worktree, "kozo/k3x9q2/K-1-t1", {
          writable: true,
        }),
      });
      expect(outcome.status).toBe("answered");
      expect(await task.repo.git("log", "-1", "--format=%s", "kozo/k3x9q2/K-1-t1")).toBe("fix");
      expect(await task.repo.git("rev-parse", "main")).toBe(task.main);
      expect(await task.repo.git("config", "--get", "core.hooksPath").catch(() => "")).toBe("");
      expect(JSON.stringify(records)).not.toContain("secret-token-value");
    },
    180_000,
  );
});
