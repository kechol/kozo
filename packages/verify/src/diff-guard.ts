import { type BaseDocumentsProblem, readBaseDocuments } from "./base-documents.ts";
import {
  type ChangedFile,
  changedFiles,
  diffCommand,
  globMatcher,
  isNewTestCase,
  literal,
  protectedPathMatcher,
  resolveRange,
} from "./changes.ts";
import { guarded } from "./command.ts";
import { GitError, git, listFiles, showFile } from "./git.ts";
import {
  changedGateScripts,
  findTestWeakening,
  gateFiles,
  includedFiles,
  reachedScripts,
  type TestWeakening,
} from "./test-weakening.ts";
import { parseChangedLines } from "./unified-diff.ts";

export type { ChangedFile };

export type Violation =
  | { kind: "lines"; changed: number; limit: number }
  | { kind: "files"; changed: number; limit: number }
  | { kind: "out-of-scope"; path: string }
  | { kind: "protected-path"; path: string; pattern: string }
  | { kind: "existing-test"; path: string; change: "modified" | "deleted" }
  | TestWeakening
  | { kind: "gate-script"; path: string; script: string }
  | { kind: "gate-file"; path: string; command: string }
  | { kind: "together"; path: string; also: string };

export type DiffGuardResult =
  | {
      status: "pass" | "fail";
      /** The merge base of the base and head refs, from which the diff is taken. */
      base: string;
      /** The tip of the base ref, from which the Charter and constraints were read. */
      documentsAt: string;
      files: ChangedFile[];
      /** The lines changed in the files that count toward the limits, generated ones left out. */
      lines: number;
      limits: { lines: number; files: number };
      /** The generated files changed and their lines, which the limits leave out. */
      generated: { files: number; lines: number };
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
  return await guarded(options.log, [GitError], () => guard(options));
}

async function guard({ cwd, base, head, scope, log }: DiffGuardOptions): Promise<DiffGuardResult> {
  const { baseTip, head: headCommit, mergeBase } = await resolveRange(cwd, base, head);
  const documents = await readBaseDocuments(cwd, baseTip);
  if (!documents.ok) {
    for (const issue of documents.issues) log(`kozo: ${issue}\n`);
    return { status: "MISCONFIGURED", reason: documents.problem };
  }
  const { charter, constraints } = documents;

  const diff = await diffCommand(cwd);
  const files = await changedFiles(cwd, diff, mergeBase, headCommit);
  const isGenerated = globMatcher(constraints.generated);
  const counted = files.filter((file) => !isGenerated(file.path));
  const sum = (some: readonly ChangedFile[]) => some.reduce((total, file) => total + file.lines, 0);
  const lines = sum(counted);
  const generated = { files: files.length - counted.length, lines: sum(files) - lines };
  const limits = { lines: charter.limits.max_changed_lines, files: charter.limits.max_files };
  const violations: Violation[] = [];
  if (lines > limits.lines) violations.push({ kind: "lines", changed: lines, limit: limits.lines });
  if (counted.length > limits.files) {
    violations.push({ kind: "files", changed: counted.length, limit: limits.files });
  }

  const inScope = scope && globMatcher(scope);
  const protectedGlobs = charter.protected_paths.map((pattern) => ({
    pattern,
    matches: protectedPathMatcher(pattern),
  }));
  const isTest = globMatcher(constraints.tests);
  for (const file of files) {
    // A new test may go wherever the repository keeps tests: it cannot weaken an existing one,
    // and prove and review judge what it checks.
    const newTest = file.change === "added" && isNewTestCase(file.path, constraints.tests);
    if (inScope && !inScope(file.path) && !newTest) {
      violations.push({ kind: "out-of-scope", path: file.path });
    }
    const hit = protectedGlobs.find(({ matches }) => matches(file.path));
    if (hit) violations.push({ kind: "protected-path", path: file.path, pattern: hit.pattern });
    if (charter.existing_tests_protected && file.change !== "added" && isTest(file.path)) {
      violations.push({ kind: "existing-test", path: file.path, change: file.change });
    }
  }

  // A change under one side of a together rule brings a change under the other.
  for (const rule of constraints.together) {
    const inWhen = globMatcher(rule.when);
    const inAlso = globMatcher(rule.also);
    const touched = files.find((file) => inWhen(file.path));
    if (touched && !files.some((file) => inAlso(file.path)))
      violations.push({ kind: "together", path: touched.path, also: rule.also.join(", ") });
  }

  const testChanges = await Promise.all(
    files
      .filter((file) => isTest(file.path))
      .map(async (file) => ({
        path: file.path,
        change: file.change,
        lines: parseChangedLines(
          await git(cwd, [...diff, "-U0", mergeBase, headCommit, "--", literal(file.path)]),
        ),
      })),
  );
  violations.push(...findTestWeakening(testChanges));
  // Workspace packages count too: a gate such as `pnpm -r test` runs their scripts by name.
  const gateCommands = Object.values(constraints.gates).map((gate) => gate.run);
  const manifests = files.filter(({ path }) => /(?:^|\/)package\.json$/.test(path));
  const scriptChanges = await Promise.all(
    manifests.map(async ({ path }) => {
      const [baseScripts, headScripts] = await Promise.all(
        [mergeBase, headCommit].map(async (commit) => scriptsOf(await showFile(cwd, commit, path))),
      );
      return changedGateScripts(gateCommands, baseScripts ?? {}, headScripts ?? {}).map(
        (script): Violation => ({ kind: "gate-script", path, script }),
      );
    }),
  );
  violations.push(...scriptChanges.flat());
  const rootScripts = scriptsOf(await showFile(cwd, mergeBase, "package.json"));
  const baseFiles = await listFiles(cwd, mergeBase);
  const runByGates = await includedFiles(
    gateFiles([...gateCommands, ...reachedScripts(gateCommands, rootScripts)]),
    (path: string) => showFile(cwd, mergeBase, path).catch(() => null),
    [...baseFiles, ...files.map((file) => file.path)],
  );
  for (const file of files) {
    const gate = runByGates.get(file.path);
    if (gate) violations.push({ kind: "gate-file", path: file.path, command: gate.command });
  }

  for (const violation of violations) log(`kozo: ${describe(violation)}\n`);
  const status = violations.length === 0 ? "pass" : "fail";
  return {
    status,
    base: mergeBase,
    documentsAt: baseTip,
    files,
    lines,
    limits,
    generated,
    violations,
  };
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
      return `the script "${violation.script}" in ${violation.path}, which a gate runs, was changed`;
    case "gate-file":
      return `${violation.path}, which the gate "${violation.command}" runs, was changed`;
    case "together":
      return `${violation.path} changed, which the constraints change together with ${violation.also}, and nothing there did`;
  }
}

/** The single line by which kozod judges diff-guard; it is always the last line printed. */
export function diffGuardLine(result: DiffGuardResult): string {
  const fields = [`status=${result.status}`];
  if (result.status === "MISCONFIGURED") fields.push(`reason=${result.reason}`);
  if (result.status === "pass" || result.status === "fail") {
    fields.push(`lines=${result.lines}/${result.limits.lines}`);
    fields.push(`files=${result.files.length - result.generated.files}/${result.limits.files}`);
    if (result.generated.files > 0)
      fields.push(`generated=${result.generated.files}files,${result.generated.lines}lines`);
    const kinds = [...new Set(result.violations.map((violation) => violation.kind))];
    if (kinds.length > 0) fields.push(`violations=${kinds.join(",")}`);
  }
  return `KOZO_DIFF_GUARD: ${fields.join(" ")}`;
}
