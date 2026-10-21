import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface TempDirectory extends AsyncDisposable {
  path: string;
}

/**
 * Creates a directory holding `files` under `parent`, the OS temporary directory by default,
 * removed on dispose.
 */
export async function tempDirectory(
  files: Record<string, string> = {},
  parent = tmpdir(),
): Promise<TempDirectory> {
  await mkdir(parent, { recursive: true });
  const path = await mkdtemp(join(parent, "kozo-test-"));
  for (const [name, content] of Object.entries(files)) await Bun.write(join(path, name), content);
  return { path, [Symbol.asyncDispose]: () => rm(path, { recursive: true, force: true }) };
}
