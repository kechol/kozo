import { type BaseDocumentsProblem, readBaseDocuments } from "./base-documents.ts";
import { GitError, git, showFile } from "./git.ts";
import { changedGateScripts, findTestWeakening, type TestWeakening } from "./test-weakening.ts";
import { parseChangedLines } from "./unified-diff.ts";

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
  | { kind: "existing-test"; path: string; change: "modified" | "deleted" }
  | TestWeakening
  | { kind: "gate-script"; script: string };

export type DiffGuardResult =
  | {
      status: "pass" | "fail";
      /** The merge base of the base and head refs, from which the diff is taken. */
      base: string;
      /** The tip of the base ref, from which the Charter and constraints were read. */
      documentsAt: string;
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
  // The documents come from the base ref's tip, not the merge base: a branch forked from an old
  // commit must not be judged by the looser Charter that commit may carry.
  const baseTip = await resolveCommit(cwd, base);
  const headCommit = await resolveCommit(cwd, head);
  const mergeBase = (await git(cwd, ["merge-base", baseTip, headCommit])).trim();
  const documents = await readBaseDocuments(cwd, baseTip);
  if (!documents.ok) {
    for (const issue of documents.issues) log(`kozo: ${issue}\n`);
    return { status: "MISCONFIGURED", reason: documents.problem };
  }
  const { charter, constraints } = documents;

  const files = await changedFiles(cwd, mergeBase, headCommit);
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
  const isTest = (path: string) => testGlobs.some((glob) => glob.match(path));
  for (const file of files) {
    if (scopeGlobs && !scopeGlobs.some((glob) => glob.match(file.path))) {
      violations.push({ kind: "out-of-scope", path: file.path });
    }
    const hit = protectedGlobs.find(({ glob }) => glob.match(file.path));
    if (hit) violations.push({ kind: "protected-path", path: file.path, pattern: hit.pattern });
    if (charter.existing_tests_protected && file.change !== "added" && isTest(file.path)) {
      violations.push({ kind: "existing-test", path: file.path, change: file.change });
    }
  }

  const testChanges = await Promise.all(
    files
      .filter((file) => isTest(file.path))
      .map(async (file) => ({
        path: file.path,
        existed: file.change !== "added",
        lines: parseChangedLines(
          await git(cwd, [...diffFlags, "-U0", mergeBase, headCommit, "--", literal(file.path)]),
        ),
      })),
  );
  violations.push(...findTestWeakening(testChanges));
  if (files.some((file) => file.path === "package.json")) {
    const gateCommands = Object.values(constraints.gates).map((gate) => gate.run);
    const [baseScripts, headScripts] = await Promise.all(
      [mergeBase, headCommit].map(async (commit) =>
        scriptsOf(await showFile(cwd, commit, "package.json")),
      ),
    );
    for (const script of changedGateScripts(gateCommands, baseScripts ?? {}, headScripts ?? {})) {
      violations.push({ kind: "gate-script", script });
    }
  }

  for (const violation of violations) log(`kozo: ${describe(violation)}\n`);
  const status = violations.length === 0 ? "pass" : "fail";
  return { status, base: mergeBase, documentsAt: baseTip, files, lines, limits, violations };
}

// Options that keep the developer's diff configuration, such as colour, external diff tools,
// text conversion or relative paths, from changing what git prints.
const diffFlags = [
  "-c",
  "core.quotePath=false",
  "diff",
  "--no-color",
  "--no-ext-diff",
  "--no-textconv",
  "--no-relative",
  "--no-renames",
];

function literal(path: string) {
  return `:(literal)${path}`;
}

function scriptsOf(text: string | null): Record<string, string> {
  if (text === null) return {};
  try {
    const scripts = (JSON.parse(text) as { scripts?: unknown }).scripts;
    if (typeof scripts !== "object" || scripts === null) return {};
    return Object.fromEntries(
      Object.entries(scripts).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
  } catch {
    // An unreadable package.json counts as having no scripts, so every gate script differs.
    return {};
  }
}

async function resolveCommit(cwd: string, ref: string) {
  return (await git(cwd, ["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`])).trim();
}

/** Lists the files that `head` changes relative to `base`, a rename counting as two files. */
async function changedFiles(cwd: string, base: string, head: string): Promise<ChangedFile[]> {
  const range = [base, head, "--"];
  const [nameStatus, numstat] = await Promise.all([
    git(cwd, [...diffFlags, "--name-status", "-z", ...range]),
    git(cwd, [...diffFlags, "--numstat", "-z", ...range]),
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
    case "disabled-test":
      return `${violation.path}:${violation.line} disables a test (${violation.marker})`;
    case "weakened-test":
      return `${violation.path} weakens its tests: ${violation.reason}`;
    case "gate-script":
      return `the package.json script "${violation.script}" that a gate runs was changed`;
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
