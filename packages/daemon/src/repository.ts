import { type Charter, parseCharter } from "@kozo/core";
import { charterPath, GitError, git, showFile } from "@kozo/verify";

async function branchExists(repository: string, branch: string) {
  try {
    await git(repository, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}^{commit}`]);
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
    if (await branchExists(repository, branch)) return branch;
  }
  throw new GitError(`${repository} has no main, master or origin/HEAD branch`);
}

export type CharterResult =
  | { ok: true; charter: Charter; commit: string }
  | { ok: false; reason: string };

/** Reads the Charter from the tip of the default branch; anything short of ready is a refusal. */
export async function readCharter(repository: string): Promise<CharterResult> {
  let branch: string;
  try {
    branch = await defaultBranch(repository);
  } catch (error) {
    return { ok: false, reason: (error as Error).message };
  }
  const commit = (await git(repository, ["rev-parse", `refs/heads/${branch}`])).trim();
  const text = await showFile(repository, commit, charterPath);
  if (text === null) return { ok: false, reason: `${charterPath} is missing on ${branch}` };
  const result = parseCharter(text);
  if (!result.ok)
    return { ok: false, reason: `${charterPath} on ${branch}: ${result.issues.join("; ")}` };
  if (result.value.status !== "ready") {
    return {
      ok: false,
      reason: `${charterPath} on ${branch} is ${result.value.status}, not ready`,
    };
  }
  return { ok: true, charter: result.value, commit };
}
