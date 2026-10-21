import { join } from "node:path";
import type { KozoHome } from "@kozo/core";
import { git } from "@kozo/verify";

/** The paths a task's sandboxed shell may and may not read and write, beyond its defaults. */
export interface SandboxPaths {
  denyRead: string[];
  allowRead: string[];
  allowWrite: string[];
  denyWrite: string[];
}

/**
 * The sandbox of one task's shell. It cannot read the factory's home, which holds the API
 * token and every other task, except its own worktree. Claude Code lets a worktree's shell
 * write the git directory it shares with the repository, so every ref but the task's own
 * branch, and the files that tie the worktree to the repository, are denied by name; a write
 * denial wins over any allowance. A branch the run creates anew is caught by the ref audit
 * after the run.
 */
export async function taskSandbox(
  home: KozoHome,
  worktree: string,
  taskBranch: string,
): Promise<SandboxPaths> {
  const [gitDir = "", commonDir = ""] = (
    await git(worktree, ["rev-parse", "--path-format=absolute", "--git-dir", "--git-common-dir"])
  )
    .trim()
    .split("\n");
  const branches = (await git(worktree, ["for-each-ref", "--format=%(refname)", "refs/heads"]))
    .split("\n")
    .filter((ref) => ref !== "" && ref !== `refs/heads/${taskBranch}`);
  return {
    denyRead: [home.root],
    allowRead: [worktree],
    allowWrite: [
      join(commonDir, "objects"),
      join(commonDir, "refs", "heads", "kozo"),
      join(commonDir, "logs", "refs", "heads", "kozo"),
      gitDir,
    ],
    denyWrite: [
      ...branches.map((ref) => join(commonDir, ...ref.split("/"))),
      join(commonDir, "refs", "tags"),
      join(commonDir, "refs", "remotes"),
      join(commonDir, "packed-refs"),
      join(commonDir, "HEAD"),
      join(commonDir, "config"),
      join(commonDir, "hooks"),
      join(worktree, ".git"),
      join(gitDir, "commondir"),
      join(gitDir, "gitdir"),
      join(gitDir, "config.worktree"),
    ],
  };
}
