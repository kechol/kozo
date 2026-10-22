import { lstat, mkdir, symlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { type Factory, repositoryTemplate } from "@kozo/core";

const exists = (path: string) =>
  lstat(path).then(
    () => true,
    () => false,
  );

/**
 * Writes kozo's repository template into `directory`, skipping every file that is already
 * there, and links `CLAUDE.md` to `AGENTS.md` when it is absent. The workflow belongs to GitHub
 * mode only. Returns the paths it wrote, in order.
 */
export async function installRepositoryTemplate(
  directory: string,
  mode: Factory["mode"],
): Promise<string[]> {
  const written: string[] = [];
  for (const [path, text] of Object.entries(repositoryTemplate)) {
    if (path.startsWith(".github/") && mode !== "github") continue;
    const target = join(directory, path);
    if (await exists(target)) continue;
    await mkdir(dirname(target), { recursive: true });
    await Bun.write(target, text);
    written.push(path);
  }
  if (!(await exists(join(directory, "CLAUDE.md")))) {
    await symlink("AGENTS.md", join(directory, "CLAUDE.md"));
    written.push("CLAUDE.md");
  }
  return written;
}
