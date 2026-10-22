import type { Factory } from "@kozo/core";

export class GitError extends Error {}

/** Runs git in `cwd` and returns its stdout; a non-zero exit throws a GitError carrying stderr. */
export async function git(cwd: string, args: readonly string[]): Promise<string> {
  // A developer's core.fsmonitor starts a daemon per repository, which costs each new worktree
  // a few hundred milliseconds and adds nothing to one-off reads.
  const child = Bun.spawn(["git", "-c", "core.fsmonitor=false", ...args], {
    cwd,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exitCode !== 0) throw new GitError(`git ${args.join(" ")}: ${stderr.trim()}`);
  return stdout;
}

/** Reads a file at a commit, or returns null when the commit does not contain it. */
export async function showFile(cwd: string, commit: string, path: string): Promise<string | null> {
  const listed = await git(cwd, ["ls-tree", "--name-only", "-z", commit, "--", path]);
  if (listed === "") return null;
  return await git(cwd, ["show", `${commit}:${path}`]);
}

/** Every file path at a commit. */
export async function listFiles(cwd: string, commit: string): Promise<string[]> {
  return (await git(cwd, ["ls-tree", "-r", "--name-only", "-z", commit]))
    .split("\0")
    .filter(Boolean);
}

/** The commit a local branch points at, or null when there is no such branch. */
export async function branchTip(repository: string, branch: string): Promise<string | null> {
  try {
    return (
      await git(repository, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}^{commit}`])
    ).trim();
  } catch (error) {
    if (error instanceof GitError) return null;
    throw error;
  }
}

/** Whether `older` is `newer` or one of its ancestors. */
export async function isAncestor(
  repository: string,
  older: string,
  newer: string,
): Promise<boolean> {
  try {
    await git(repository, ["merge-base", "--is-ancestor", older, newer]);
    return true;
  } catch (error) {
    if (error instanceof GitError) return false;
    throw error;
  }
}

/**
 * The repository's default branch: the local branch that origin/HEAD names, else main or
 * master, whichever exists.
 */
export async function defaultBranch(repository: string): Promise<string> {
  let remoteHead = "";
  try {
    remoteHead = (
      await git(repository, ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"])
    ).trim();
  } catch (error) {
    if (!(error instanceof GitError)) throw error;
  }
  const candidates = [remoteHead.replace(/^origin\//, ""), "main", "master"].filter(Boolean);
  for (const branch of candidates) {
    if ((await branchTip(repository, branch)) !== null) return branch;
  }
  throw new GitError(`${repository} has no main, master or origin/HEAD branch`);
}

/**
 * A repository's default branch as kozod and kozo check read it. In GitHub mode merges happen on GitHub, so the
 * base is origin's branch after a fetch, and no local branch ever has to move.
 */
export interface Base {
  branch: string;
  /** What git ranges and kozo's commands take: the branch name, or origin's ref. */
  base: string;
  /** The full ref, for reading the tip. */
  ref: string;
}

export async function baseOf(repository: string, mode: Factory["mode"]): Promise<Base> {
  const branch = await defaultBranch(repository);
  if (mode === "github") {
    const ref = `refs/remotes/origin/${branch}`;
    return { branch, base: ref, ref };
  }
  return { branch, base: branch, ref: `refs/heads/${branch}` };
}
