import { type Charter, type Constraints, parseCharter, parseConstraints } from "@kozo/core";
import { showFile } from "./git.ts";

// Repository paths, used both on disk and inside git commits.
export const charterPath = ".kozo/charter.yml";
export const constraintsPath = ".kozo/constraints.yml";

export type BaseDocumentsProblem =
  | "charter-missing"
  | "charter-invalid"
  | "constraints-missing"
  | "constraints-invalid";

export type BaseDocuments =
  | { ok: true; charter: Charter; constraints: Constraints }
  | { ok: false; problem: BaseDocumentsProblem; issues: string[] };

/**
 * Reads the Charter and the constraints as they are at `commit`, the tip of the base ref, so
 * that no commit inside the diff under check supplies the limits it is judged by.
 */
export async function readBaseDocuments(cwd: string, commit: string): Promise<BaseDocuments> {
  const [charterText, constraintsText] = await Promise.all([
    showFile(cwd, commit, charterPath),
    showFile(cwd, commit, constraintsPath),
  ]);
  if (charterText === null) return { ok: false, problem: "charter-missing", issues: [] };
  const charter = parseCharter(charterText);
  if (!charter.ok) return { ok: false, problem: "charter-invalid", issues: charter.issues };
  if (constraintsText === null) return { ok: false, problem: "constraints-missing", issues: [] };
  const constraints = parseConstraints(constraintsText);
  if (!constraints.ok) {
    return { ok: false, problem: "constraints-invalid", issues: constraints.issues };
  }
  return { ok: true, charter: charter.value, constraints: constraints.value };
}
