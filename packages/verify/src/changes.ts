import { GitError, git } from "./git.ts";

export interface ChangedFile {
  path: string;
  change: "added" | "modified" | "deleted";
  /** Added plus deleted lines; zero for binary files. */
  lines: number;
}

/**
 * The git arguments, up to and including `diff`, that keep configuration from changing what the
 * diff prints: the developer's colour, external diff tools, text conversion and relative paths,
 * and the repository's own .gitattributes, whose binary or -diff entries would hide a file's
 * lines. Attributes are read from the empty tree instead.
 */
export async function diffCommand(cwd: string): Promise<string[]> {
  const emptyTree = (await git(cwd, ["hash-object", "-t", "tree", "/dev/null"])).trim();
  return [
    `--attr-source=${emptyTree}`,
    "-c",
    "core.attributesFile=/dev/null",
    "-c",
    "core.quotePath=false",
    "diff",
    "--no-color",
    "--no-ext-diff",
    "--no-textconv",
    "--no-relative",
    "--no-renames",
    "--text",
  ];
}

export function literal(path: string) {
  return `:(literal)${path}`;
}

export async function resolveCommit(cwd: string, ref: string) {
  return (await git(cwd, ["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`])).trim();
}

/** Lists the files that `head` changes relative to `base`, a rename counting as two files. */
export async function changedFiles(
  cwd: string,
  diff: readonly string[],
  base: string,
  head: string,
): Promise<ChangedFile[]> {
  const range = [base, head, "--"];
  const [nameStatus, numstat] = await Promise.all([
    git(cwd, [...diff, "--name-status", "-z", ...range]),
    git(cwd, [...diff, "--numstat", "-z", ...range]),
  ]);

  const lines = new Map<string, number>();
  for (const record of numstat.split("\0")) {
    if (record === "") continue;
    // A path may itself contain tabs, so only the first two separate the counts.
    const first = record.indexOf("\t");
    const second = record.indexOf("\t", first + 1);
    if (first < 0 || second < 0) throw new GitError(`unexpected numstat record: ${record}`);
    const [added, deleted] = [record.slice(0, first), record.slice(first + 1, second)];
    // Binary files report "-" for both counts.
    lines.set(record.slice(second + 1), (Number(added) || 0) + (Number(deleted) || 0));
  }

  const fields = nameStatus.split("\0");
  const files: ChangedFile[] = [];
  for (let index = 0; index + 1 < fields.length; index += 2) {
    const status = fields[index] ?? "";
    const path = fields[index + 1] ?? "";
    const change = status === "A" ? "added" : status === "D" ? "deleted" : "modified";
    const count = lines.get(path);
    if (count === undefined) throw new GitError(`no line count for ${path}`);
    files.push({ path, change, lines: count });
  }
  return files;
}
