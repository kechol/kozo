export class GitError extends Error {}

/** Runs git in `cwd` and returns its stdout; a non-zero exit throws a GitError carrying stderr. */
export async function git(cwd: string, args: readonly string[]): Promise<string> {
  const child = Bun.spawn(["git", ...args], {
    cwd,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exitCode !== 0) throw new GitError(`git ${args.join(" ")}: ${stderr.trim()}`);
  return stdout;
}

/** Reads a file at a commit, or returns null when the commit does not contain it. */
export async function showFile(cwd: string, commit: string, path: string): Promise<string | null> {
  const listed = await git(cwd, ["ls-tree", "--name-only", "-z", commit, "--", path]);
  if (listed === "") return null;
  return await git(cwd, ["show", `${commit}:${path}`]);
}
