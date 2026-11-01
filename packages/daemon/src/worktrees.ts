import { mkdir, rm, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { type KozoHome, type Message, message, parseReference, sha256 } from "@kozo/core";
import { branchTip, GitError, git } from "@kozo/verify";
import { releasePorts } from "./worktree-ports.ts";

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
  | { claimed: false; reason: Message };

async function exists(path: string) {
  return stat(path).then(
    () => true,
    () => false,
  );
}

/** Whether a task's worktree has been made, which its first run's claim does. */
export async function hasWorktree(worktree: string): Promise<boolean> {
  return stat(worktree).then(
    (entry) => entry.isDirectory(),
    () => false,
  );
}

/**
 * Claims a task by creating its branch at `base`, the tip of the repository's base, and checks
 * it out in the task's worktree. A branch that already exists belongs to whoever created it, so
 * only `resume`, for a task this factory already claimed, may reuse it.
 */
export async function claimTask(
  home: KozoHome,
  repository: string,
  task: string,
  { factory, base, resume = false }: { factory: string; base: string; resume?: boolean },
): Promise<Claim> {
  const branch = taskBranch(factory, task);
  const worktree = worktreePath(home, repository, task);
  const tip = base;
  const existing = await branchTip(repository, branch);
  if (existing !== null && !resume) {
    return { claimed: false, reason: message("hold.branch-exists", { branch, repository }) };
  }
  if (existing === null) {
    try {
      await git(repository, ["branch", "--no-track", branch, tip]);
    } catch (error) {
      if (error instanceof GitError)
        return { claimed: false, reason: message("text", { text: error.message }) };
      throw error;
    }
  }
  if (!(await exists(worktree))) {
    await mkdir(home.worktrees, { recursive: true });
    await git(repository, ["worktree", "add", "--quiet", worktree, branch]);
  }
  return { claimed: true, branch, worktree, base: tip, created: existing === null };
}

/** Makes `dir` a fresh worktree of `repository` detached at `commit`, for kozod's own reading. */
export async function detachedCheckout(
  home: KozoHome,
  repository: string,
  dir: string,
  commit: string,
) {
  await rm(dir, { recursive: true, force: true });
  await git(repository, ["worktree", "prune"]);
  await mkdir(home.worktrees, { recursive: true });
  await git(repository, ["worktree", "add", "--quiet", "--detach", dir, commit]);
}

/** Removes a worktree that detachedCheckout made, ignoring one that is already gone. */
export async function removeCheckout(repository: string, dir: string) {
  await git(repository, ["worktree", "remove", "--force", dir]).catch(() => {});
}

/**
 * Brings the checkout a task's services run in, beside its worktree and kept for the task's
 * life, to `commit`, and makes it when it is missing. Moving it in place keeps the directory the
 * services' containers may mount.
 */
export async function servicesCheckout(
  home: KozoHome,
  repository: string,
  worktree: string,
  commit: string,
): Promise<string> {
  const checkout = `${worktree}.services`;
  const moved = await exists(checkout).then(
    (found) =>
      found &&
      git(checkout, [
        "-c",
        "core.hooksPath=/dev/null",
        "checkout",
        "--quiet",
        "--force",
        "--detach",
        commit,
      ]).then(
        () => true,
        () => false,
      ),
  );
  if (!moved) await detachedCheckout(home, repository, checkout, commit);
  return checkout;
}

/**
 * Removes a task's worktree and the markers kozod keeps beside it, so that a worktree made again
 * at the same path is prepared afresh, and when cancelling deletes its branch too.
 */
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
  await removeCheckout(repository, `${worktree}.services`);
  await git(repository, ["worktree", "prune"]);
  await rm(`${worktree}.prepared`, { force: true });
  await releasePorts(worktree);
  if (deleteBranch && (await branchTip(repository, branch)) !== null) {
    await git(repository, ["branch", "-D", branch]);
  }
}
