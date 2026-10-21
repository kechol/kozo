import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface TempDirectory extends AsyncDisposable {
  path: string;
}

/** Creates a directory under the OS temporary directory holding `files`, removed on dispose. */
export async function tempDirectory(files: Record<string, string> = {}): Promise<TempDirectory> {
  const path = await mkdtemp(join(tmpdir(), "kozo-test-"));
  for (const [name, content] of Object.entries(files)) await Bun.write(join(path, name), content);
  return { path, [Symbol.asyncDispose]: () => rm(path, { recursive: true, force: true }) };
}
