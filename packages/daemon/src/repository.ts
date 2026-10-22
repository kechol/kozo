import { type Charter, type Factory, parseCharter } from "@kozo/core";
import { charterPath, defaultBranch, git, showFile } from "@kozo/verify";

/**
 * A repository's default branch as kozod reads it. In GitHub mode merges happen on GitHub, so the
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

export type CharterResult =
  | { ok: true; charter: Charter; commit: string }
  | { ok: false; reason: string };

/** Reads the Charter from the tip of the base; anything short of ready is a refusal. */
export async function readCharter(
  repository: string,
  mode: Factory["mode"],
): Promise<CharterResult> {
  let branch: string;
  let ref: string;
  try {
    ({ branch, ref } = await baseOf(repository, mode));
  } catch (error) {
    return { ok: false, reason: (error as Error).message };
  }
  const commit = (await git(repository, ["rev-parse", ref])).trim();
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
