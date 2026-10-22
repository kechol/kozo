import { mkdir, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { type KozoHome, parseReference, sha256 } from "@kozo/core";
import { branchTip, defaultBranch, GitError, git } from "@kozo/verify";

function taskParts(task: string) {
  const reference = parseReference(task);
  if (reference?.kind !== "task") throw new Error(`${task} is not a task reference`);
  const { repo, number } = reference.item;
  return { item: repo === null ? `K-${number}` : String(number), task: reference.task };
}

/** The branch that holds a task's diff, under the factory's own ID. */
export function taskBranch(factory: string, task: string): string {
  const parts = taskParts(task);
  return `kozo/${factory}/${parts.item}-t${parts.task}`;
}

/**
 * The name a repository's checkouts start with: its directory name, then a hash of its path, so
 * that two repositories with one name and the same GitHub-mode numbers stay apart.
 */
function repositoryPrefix(repository: string): string {
  const hash = sha256(repository).slice(0, 8);
  return `${basename(repository)}-${hash}`;
}

/** The worktree directory of a task. */
export function worktreePath(home: KozoHome, repository: string, task: string): string {
  const parts = taskParts(task);
  return join(home.worktrees, `${repositoryPrefix(repository)}-${parts.item}-t${parts.task}`);
}

/** The read-only checkout in which triage investigates an item. */
export function triageCheckoutPath(home: KozoHome, repository: string, item: string): string {
  return join(home.worktrees, `${repositoryPrefix(repository)}-${item}-triage`);
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

/**
 * Claims a task by creating its branch at the tip of the default branch and checks it out in
 * the task's worktree. A branch that already exists belongs to whoever created it, so only
 * `resume`, for a task this factory already claimed, may reuse it.
 */
export async function claimTask(
  home: KozoHome,
  repository: string,
  task: string,
  { factory, resume = false }: { factory: string; resume?: boolean },
): Promise<Claim> {
  const branch = taskBranch(factory, task);
  const worktree = worktreePath(home, repository, task);
  const tip = (
    await git(repository, ["rev-parse", `refs/heads/${await defaultBranch(repository)}`])
  ).trim();
  const existing = await branchTip(repository, branch);
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
  { factory, deleteBranch }: { factory: string; deleteBranch: boolean },
) {
  const branch = taskBranch(factory, task);
  const worktree = worktreePath(home, repository, task);
  if (await exists(worktree)) {
    await git(repository, ["worktree", "remove", "--force", worktree]);
  }
  await git(repository, ["worktree", "prune"]);
  if (deleteBranch && (await branchTip(repository, branch)) !== null) {
    await git(repository, ["branch", "-D", branch]);
  }
}
