import { mkdir, rename } from "node:fs/promises";
import { join } from "node:path";
import { type VerdictFile, verdictFileSchema } from "@kozo/core";

/**
 * Records one judge's verdict in `<dir>/verdict.json`, keeping the other judges' verdicts there.
 * The file is replaced by a rename, so a reader never sees it half written. Updates to one
 * directory are not serialized: the caller runs one judge at a time per run directory.
 */
export async function updateVerdictFile(
  dir: string,
  verdict: Omit<VerdictFile, "version">,
): Promise<string> {
  const path = join(dir, "verdict.json");
  const file = Bun.file(path);
  const existing: VerdictFile = (await file.exists())
    ? verdictFileSchema.parse(await file.json())
    : { version: 1 };
  await mkdir(dir, { recursive: true });
  const temporary = join(dir, `.verdict.json.${process.pid}`);
  await Bun.write(
    temporary,
    `${JSON.stringify(verdictFileSchema.parse({ ...existing, ...verdict }), null, 2)}\n`,
  );
  await rename(temporary, path);
  return path;
}
