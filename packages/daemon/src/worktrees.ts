import { mkdir, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { type KozoHome, parseReference } from "@kozo/core";
import { GitError, git } from "@kozo/verify";
import { defaultBranch } from "./repository.ts";

function taskParts(task: string) {
  const reference = parseReference(task);
  if (reference?.kind !== "task") throw new Error(`${task} is not a task reference`);
  const { repo, number } = reference.item;
  return { item: repo === null ? `K-${number}` : String(number), task: reference.task };
}

/** The branch that holds a task's diff. */
export function taskBranch(task: string): string {
  const parts = taskParts(task);
  return `kozo/${parts.item}-t${parts.task}`;
}

/** The worktree directory of a task; the repository's name keeps GitHub-mode numbers apart. */
export function worktreePath(home: KozoHome, repository: string, task: string): string {
  const parts = taskParts(task);
  return join(home.worktrees, `${basename(repository)}-${parts.item}-t${parts.task}`);
}

export type Claim =
  | { claimed: true; branch: string; worktree: string; base: string; created: boolean }
  | { claimed: false; reason: string };

async function exists(path: string) {
  return stat(path).then(
    () => true,
    () => false,
  );
}

async function branchCommit(repository: string, branch: string): Promise<string | null> {
  try {
    return (
      await git(repository, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`])
    ).trim();
  } catch (error) {
    if (error instanceof GitError) return null;
    throw error;
  }
}

/**
 * Claims a task by creating its branch at the tip of the default branch and checks it out in
 * the task's worktree. A branch that already exists belongs to whoever created it, so only
 * `resume`, for a task this factory already claimed, may reuse it.
 */
export async function claimTask(
  home: KozoHome,
  repository: string,
  task: string,
  { resume = false } = {},
): Promise<Claim> {
  const branch = taskBranch(task);
  const worktree = worktreePath(home, repository, task);
  const tip = (
    await git(repository, ["rev-parse", `refs/heads/${await defaultBranch(repository)}`])
  ).trim();
  const existing = await branchCommit(repository, branch);
  if (existing !== null && !resume) {
    return { claimed: false, reason: `${branch} already exists in ${repository}` };
  }
  if (existing === null) {
    try {
      await git(repository, ["branch", "--no-track", branch, tip]);
    } catch (error) {
      if (error instanceof GitError) return { claimed: false, reason: error.message };
      throw error;
    }
  }
  if (!(await exists(worktree))) {
    await mkdir(home.worktrees, { recursive: true });
    await git(repository, ["worktree", "add", "--quiet", worktree, branch]);
  }
  return { claimed: true, branch, worktree, base: tip, created: existing === null };
}

/** Removes a task's worktree and, when cancelling, deletes its branch too. */
export async function releaseTask(
  home: KozoHome,
  repository: string,
  task: string,
  { deleteBranch }: { deleteBranch: boolean },
) {
  const worktree = worktreePath(home, repository, task);
  if (await exists(worktree)) {
    await git(repository, ["worktree", "remove", "--force", worktree]);
  }
  await git(repository, ["worktree", "prune"]);
  if (deleteBranch && (await branchCommit(repository, taskBranch(task))) !== null) {
    await git(repository, ["branch", "-D", taskBranch(task)]);
  }
}
