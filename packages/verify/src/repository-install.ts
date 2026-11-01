import { lstat, mkdir, symlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { repositoryTemplate } from "@kozo/core";

const exists = (path: string) =>
  lstat(path).then(
    () => true,
    () => false,
  );

/** Where the template goes: GitHub mode's workflow runs on the repository's own default branch. */
export type InstallTarget = { mode: "local" } | { mode: "github"; defaultBranch: string };

/**
 * Writes kozo's repository template into `directory`, skipping every file that is already
 * there, and links `CLAUDE.md` to `AGENTS.md` when it is absent. The workflow belongs to GitHub
 * mode only. Returns the paths it wrote, in order.
 */
export async function installRepositoryTemplate(
  directory: string,
  install: InstallTarget,
): Promise<string[]> {
  const written: string[] = [];
  for (const [path, template] of Object.entries(repositoryTemplate)) {
    if (path.startsWith(".github/") && install.mode !== "github") continue;
    const target = join(directory, path);
    if (await exists(target)) continue;
    // A YAML double-quoted string reads a JSON string as it is, whatever the branch is named.
    const text =
      install.mode === "github"
        ? template.replaceAll('"{default_branch}"', JSON.stringify(install.defaultBranch))
        : template;
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
