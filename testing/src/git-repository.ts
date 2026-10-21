import { rm } from "node:fs/promises";
import { join } from "node:path";
import { type TempDirectory, tempDirectory } from "./temp-directory.ts";

export interface GitRepository extends TempDirectory {
  /** Writes `files` (null deletes one), commits them all and returns the commit's object name. */
  commit(files: Record<string, string | null>, message?: string): Promise<string>;
  git(...args: string[]): Promise<string>;
}

// The developer's own git configuration, such as commit signing or hooks, never reaches tests.
const isolated = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "kozo test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "kozo test",
  GIT_COMMITTER_EMAIL: "test@example.com",
};

/** Creates a git repository on `main` in a temporary directory, removed on dispose. */
export async function gitRepository(): Promise<GitRepository> {
  const directory = await tempDirectory();
  const git = async (...args: string[]) => {
    const child = Bun.spawn(["git", ...args], {
      cwd: directory.path,
      env: isolated,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    if (code !== 0) throw new Error(`git ${args.join(" ")} failed: ${stderr}`);
    return stdout.trim();
  };
  await git("init", "--quiet", "--initial-branch=main");
  return {
    ...directory,
    git,
    async commit(files, message = "change") {
      for (const [name, content] of Object.entries(files)) {
        const path = join(directory.path, name);
        if (content === null) await rm(path);
        else await Bun.write(path, content);
      }
      await git("add", "--all");
      await git("commit", "--quiet", "--allow-empty", "--message", message);
      return await git("rev-parse", "HEAD");
    },
  };
}
