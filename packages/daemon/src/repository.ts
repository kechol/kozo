import {
  type Charter,
  demotedCharter,
  type Factory,
  type FactoryState,
  parseCharter,
  sha256,
} from "@kozo/core";
import { baseOf, charterPath, git, showFile } from "@kozo/verify";

export type CharterResult =
  | { ok: true; charter: Charter; commit: string; sha: string }
  | { ok: false; reason: string };

/**
 * Reads the Charter from the tip of the base; anything short of ready is a refusal. With
 * `state`, the levels are the ones kozod applies, its demotions included.
 */
export async function readCharter(
  repository: string,
  mode: Factory["mode"],
  state?: FactoryState,
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
  const sha = sha256(text);
  const charter = state ? demotedCharter(state, repository, result.value, sha) : result.value;
  return { ok: true, charter, commit, sha };
}
