import { type BaseDocumentsProblem, readBaseDocuments } from "./base-documents.ts";
import { GitError, git } from "./git.ts";

export interface ChangedFile {
  path: string;
  change: "added" | "modified" | "deleted";
  /** Added plus deleted lines; zero for binary files. */
  lines: number;
}

export type Violation =
  | { kind: "lines"; changed: number; limit: number }
  | { kind: "files"; changed: number; limit: number }
  | { kind: "out-of-scope"; path: string }
  | { kind: "protected-path"; path: string; pattern: string }
  | { kind: "existing-test"; path: string; change: "modified" | "deleted" };

export type DiffGuardResult =
  | {
      status: "pass" | "fail";
      /** The merge base of the base and head refs, from which the Charter was read. */
      base: string;
      files: ChangedFile[];
      lines: number;
      limits: { lines: number; files: number };
      violations: Violation[];
    }
  | { status: "MISCONFIGURED"; reason: BaseDocumentsProblem }
  | { status: "error"; message: string };

export interface DiffGuardOptions {
  cwd: string;
  base: string;
  head: string;
  /** The task's scope; when omitted, files are not checked against a scope. */
  scope?: readonly string[];
  log(text: string): void;
}

export async function runDiffGuard(options: DiffGuardOptions): Promise<DiffGuardResult> {
  try {
    return await guard(options);
  } catch (error) {
    if (!(error instanceof GitError)) throw error;
    options.log(`kozo: ${error.message}\n`);
    return { status: "error", message: error.message };
  }
}

async function guard({ cwd, base, head, scope, log }: DiffGuardOptions): Promise<DiffGuardResult> {
  const mergeBase = (await git(cwd, ["merge-base", base, head])).trim();
  const documents = await readBaseDocuments(cwd, mergeBase);
  if (!documents.ok) {
    for (const issue of documents.issues) log(`kozo: ${issue}\n`);
    return { status: "MISCONFIGURED", reason: documents.problem };
  }
  const { charter, constraints } = documents;

  const files = await changedFiles(cwd, mergeBase, head);
  const lines = files.reduce((sum, file) => sum + file.lines, 0);
  const limits = { lines: charter.limits.max_changed_lines, files: charter.limits.max_files };
  const violations: Violation[] = [];
  if (lines > limits.lines) violations.push({ kind: "lines", changed: lines, limit: limits.lines });
  if (files.length > limits.files) {
    violations.push({ kind: "files", changed: files.length, limit: limits.files });
  }

  const scopeGlobs = scope?.map((pattern) => new Bun.Glob(pattern));
  const protectedGlobs = charter.protected_paths.map((pattern) => ({
    pattern,
    glob: new Bun.Glob(pattern),
  }));
  const testGlobs = constraints.tests.map((pattern) => new Bun.Glob(pattern));
  for (const file of files) {
    if (scopeGlobs && !scopeGlobs.some((glob) => glob.match(file.path))) {
      violations.push({ kind: "out-of-scope", path: file.path });
    }
    const hit = protectedGlobs.find(({ glob }) => glob.match(file.path));
    if (hit) violations.push({ kind: "protected-path", path: file.path, pattern: hit.pattern });
    if (
      charter.existing_tests_protected &&
      file.change !== "added" &&
      testGlobs.some((glob) => glob.match(file.path))
    ) {
      violations.push({ kind: "existing-test", path: file.path, change: file.change });
    }
  }

  for (const violation of violations) log(`kozo: ${describe(violation)}\n`);
  const status = violations.length === 0 ? "pass" : "fail";
  return { status, base: mergeBase, files, lines, limits, violations };
}

/** Lists the files that `head` changes relative to `base`, a rename counting as two files. */
async function changedFiles(cwd: string, base: string, head: string): Promise<ChangedFile[]> {
  const range = [base, head, "--"];
  const [nameStatus, numstat] = await Promise.all([
    git(cwd, ["diff", "--no-renames", "--no-ext-diff", "--name-status", "-z", ...range]),
    git(cwd, ["diff", "--no-renames", "--no-ext-diff", "--numstat", "-z", ...range]),
  ]);

  const lines = new Map<string, number>();
  for (const record of numstat.split("\0")) {
    const [added, deleted, path] = record.split("\t");
    if (path === undefined) continue;
    // Binary files report "-" for both counts.
    lines.set(path, (Number(added) || 0) + (Number(deleted) || 0));
  }

  const fields = nameStatus.split("\0");
  const files: ChangedFile[] = [];
  for (let index = 0; index + 1 < fields.length; index += 2) {
    const status = fields[index] ?? "";
    const path = fields[index + 1] ?? "";
    const change = status === "A" ? "added" : status === "D" ? "deleted" : "modified";
    files.push({ path, change, lines: lines.get(path) ?? 0 });
  }
  return files;
}

function describe(violation: Violation): string {
  switch (violation.kind) {
    case "lines":
      return `the diff changes ${violation.changed} lines; the Charter allows ${violation.limit}`;
    case "files":
      return `the diff changes ${violation.changed} files; the Charter allows ${violation.limit}`;
    case "out-of-scope":
      return `${violation.path} is outside the task's scope`;
    case "protected-path":
      return `${violation.path} is a protected path (${violation.pattern})`;
    case "existing-test":
      return `${violation.path} is an existing test file and was ${violation.change}`;
  }
}

/** The single line by which kozod judges diff-guard; it is always the last line printed. */
export function diffGuardLine(result: DiffGuardResult): string {
  const fields = [`status=${result.status}`];
  if (result.status === "MISCONFIGURED") fields.push(`reason=${result.reason}`);
  if (result.status === "pass" || result.status === "fail") {
    fields.push(`lines=${result.lines}/${result.limits.lines}`);
    fields.push(`files=${result.files.length}/${result.limits.files}`);
    const kinds = [...new Set(result.violations.map((violation) => violation.kind))];
    if (kinds.length > 0) fields.push(`violations=${kinds.join(",")}`);
  }
  return `KOZO_DIFF_GUARD: ${fields.join(" ")}`;
}
