import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { type VerdictFile, verdictFileSchema } from "@kozo/core";

/** Records one judge's verdict in `<dir>/verdict.json`, keeping the other judges' verdicts there. */
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
  await Bun.write(
    path,
    `${JSON.stringify(verdictFileSchema.parse({ ...existing, ...verdict }), null, 2)}\n`,
  );
  return path;
}
