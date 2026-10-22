import { describe, expect, test } from "bun:test";
import { kozoHome } from "@kozo/core";
import { gitRepository, tempDirectory } from "@kozo/testing";
import { factoryGitEnvironment } from "@kozo/worker";
import { claimTask, releaseTask, taskBranch, worktreePath } from "./worktrees.ts";

describe("task branches", () => {
  test("are named from the task reference", () => {
    expect(taskBranch("k3x9q2", "K-12/t1")).toBe("kozo/k3x9q2/K-12-t1");
    expect(taskBranch("k3x9q2", "app#212/t2")).toBe("kozo/k3x9q2/212-t2");
    expect(() => taskBranch("k3x9q2", "K-12")).toThrow("not a task reference");
  });

  test("worktrees keep two repositories of one name apart", () => {
    const home = kozoHome("/h");
    const one = worktreePath(home, "/src/a/app", "app#212/t2");
    const other = worktreePath(home, "/src/b/app", "app#212/t2");
    expect(one).toMatch(/^\/h\/worktrees\/app-[0-9a-f]{8}-212-t2$/);
    expect(other).not.toBe(one);
  });
});

const factory = "k3x9q2";

describe("claimTask", () => {
  test("branches from the default branch tip, claims once and reuses its worktree", async () => {
    await using repo = await gitRepository();
    await using dir = await tempDirectory();
    const home = kozoHome(dir.path);
    const tip = await repo.commit({ "README.md": "# shop\n" }, "start");
    await repo.git("switch", "--quiet", "-c", "human-work");
    await repo.commit({ "notes.md": "wip\n" }, "wip");

    const claim = await claimTask(home, repo.path, "K-1/t1", { factory, base: tip });
    expect(claim).toMatchObject({
      claimed: true,
      branch: "kozo/k3x9q2/K-1-t1",
      base: tip,
      created: true,
    });
    if (!claim.claimed) return;
    expect(await Bun.file(`${claim.worktree}/README.md`).exists()).toBe(true);
    expect(await Bun.file(`${claim.worktree}/notes.md`).exists()).toBe(false);

    expect(await claimTask(home, repo.path, "K-1/t1", { factory, base: tip })).toEqual({
      claimed: false,
      reason: `kozo/k3x9q2/K-1-t1 already exists in ${repo.path}`,
    });
    const resumed = await claimTask(home, repo.path, "K-1/t1", {
      factory,
      base: tip,
      resume: true,
    });
    expect(resumed).toMatchObject({ claimed: true, worktree: claim.worktree, created: false });
  });

  test("commits in the worktree are kozo's and unsigned, and cancelling removes everything", async () => {
    await using repo = await gitRepository();
    await using dir = await tempDirectory();
    const home = kozoHome(dir.path);
    const tip = await repo.commit({ "README.md": "# shop\n" }, "start");
    await repo.git("config", "commit.gpgsign", "true");
    const claim = await claimTask(home, repo.path, "K-1/t1", { factory, base: tip });
    if (!claim.claimed) throw new Error("expected a claim");
    await Bun.write(`${claim.worktree}/fix.ts`, "export {};\n");
    const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", ...factoryGitEnvironment };
    for (const args of [
      ["add", "--all"],
      ["commit", "--quiet", "-m", "fix"],
    ]) {
      const child = Bun.spawn(["git", ...args], { cwd: claim.worktree, env, stderr: "pipe" });
      expect(await child.exited).toBe(0);
    }
    expect(await repo.git("log", "-1", "--format=%an <%ae> %G?", "kozo/k3x9q2/K-1-t1")).toBe(
      "kozo <kozo@localhost.invalid> N",
    );

    await releaseTask(home, repo.path, "K-1/t1", { factory, deleteBranch: true });
    expect(await Bun.file(`${claim.worktree}/fix.ts`).exists()).toBe(false);
    expect(await repo.git("branch", "--list", "kozo/*")).toBe("");
    await releaseTask(home, repo.path, "K-1/t1", { factory, deleteBranch: true });
  });
});
