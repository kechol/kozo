import { type Charter, parseCharter } from "@kozo/core";
import { charterPath, defaultBranch, git, showFile } from "@kozo/verify";

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
