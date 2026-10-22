import { unlink } from "node:fs/promises";
import { join } from "node:path";
import { type BaseDocumentsProblem, readBaseDocuments } from "./base-documents.ts";
import { changedFiles, diffCommand, globMatcher, literal, resolveRange } from "./changes.ts";
import { guarded, runCommand, secondsSince, shellQuote } from "./command.ts";
import { GitError, git } from "./git.ts";

export interface ProveRun {
  files: string[];
  command: string;
  /** The exit code with the whole diff applied, which must be zero. */
  withChange: number;
  /** The exit code with the non-test changes reverted, which must not be zero; null if not run. */
  withoutChange: number | null;
  seconds: number;
}

export type ProveResult =
  | {
      status: "pass" | "fail";
      /** Why prove failed: no runnable changed tests, a test failing with the change, or one passing without it. */
      reason?: "no-tests" | "fails-with-change" | "passes-without-change";
      base: string;
      documentsAt: string;
      reverted: string[];
      runs: ProveRun[];
    }
  | { status: "MISCONFIGURED"; reason: BaseDocumentsProblem | "no-prove-entries" }
  | { status: "error"; message: string };

export interface ProveOptions {
  cwd: string;
  base: string;
  log(text: string): void;
  /** The test commands' environment; they inherit this process's when it is unset. */
  env?: Record<string, string>;
}

/**
 * Proves that the changed tests test the change: they must pass at HEAD and fail once every
 * non-test change is reverted. The revert happens in place, so the worktree must be clean, and
 * it is restored to HEAD before returning.
 */
export async function runProve(options: ProveOptions): Promise<ProveResult> {
  return await guarded(options.log, [GitError], () => prove(options));
}

async function prove({ cwd, base, log, env }: ProveOptions): Promise<ProveResult> {
  const { baseTip, head, mergeBase } = await resolveRange(cwd, base, "HEAD");
  const documents = await readBaseDocuments(cwd, baseTip);
  if (!documents.ok) {
    for (const issue of documents.issues) log(`kozo: ${issue}\n`);
    return { status: "MISCONFIGURED", reason: documents.problem };
  }
  const { constraints } = documents;
  if (constraints.prove.length === 0) {
    log("kozo: the constraints define no prove entries\n");
    return { status: "MISCONFIGURED", reason: "no-prove-entries" };
  }
  if (await isDirty(cwd)) {
    const message = "the worktree has uncommitted changes; prove reverts files in place";
    log(`kozo: ${message}\n`);
    return { status: "error", message };
  }

  const isTest = globMatcher(constraints.tests);
  const files = await changedFiles(cwd, await diffCommand(cwd), mergeBase, head);
  const nonTests = files.filter((file) => !isTest(file.path));
  // Each changed test file runs once, under the first entry that matches it.
  const entries = constraints.prove.map((entry) => ({
    run: entry.run,
    matches: globMatcher(entry.files),
    files: [] as string[],
  }));
  for (const file of files) {
    if (file.change === "deleted" || !isTest(file.path)) continue;
    entries.find(({ matches }) => matches(file.path))?.files.push(file.path);
  }
  const result = {
    base: mergeBase,
    documentsAt: baseTip,
    reverted: nonTests.map((file) => file.path),
  };
  const runs: ProveRun[] = entries
    .filter((entry) => entry.files.length > 0)
    .map(({ run, files }) => ({
      files,
      command: run.replaceAll("{files}", files.map(shellQuote).join(" ")),
      withChange: 0,
      withoutChange: null,
      seconds: 0,
    }));
  if (runs.length === 0) {
    log("kozo: the diff changes no test file that a prove entry runs\n");
    return { status: "fail", reason: "no-tests", ...result, runs };
  }
  for (const run of runs) {
    log(`==> with the change: ${run.command}\n`);
    const started = performance.now();
    run.withChange = await runCommand(run.command, cwd, log, env);
    run.seconds += secondsSince(started);
    if (run.withChange !== 0) {
      log(`kozo: the tests fail with the change applied: ${run.files.join(", ")}\n`);
      return { status: "fail", reason: "fails-with-change", ...result, runs };
    }
  }

  try {
    await revert(cwd, mergeBase, nonTests);
    for (const run of runs) {
      log(`==> without the change: ${run.command}\n`);
      const started = performance.now();
      run.withoutChange = await runCommand(run.command, cwd, log, env);
      run.seconds += secondsSince(started);
    }
  } finally {
    await git(cwd, ["reset", "--quiet", "--hard", head]);
  }
  if (await isDirty(cwd, "no")) throw new GitError("the worktree was not restored to HEAD");

  const unproved = runs.filter((run) => run.withoutChange === 0);
  for (const run of unproved) {
    log(
      `kozo: the tests pass without the change, so they do not prove it: ${run.files.join(", ")}\n`,
    );
  }
  if (unproved.length > 0)
    return { status: "fail", reason: "passes-without-change", ...result, runs };
  return { status: "pass", ...result, runs };
}

async function revert(
  cwd: string,
  base: string,
  files: readonly { path: string; change: "added" | "modified" | "deleted" }[],
) {
  const restore = files.filter((file) => file.change !== "added").map((file) => literal(file.path));
  if (restore.length > 0) await git(cwd, ["checkout", base, "--", ...restore]);
  for (const file of files.filter(({ change }) => change === "added")) {
    await unlink(join(cwd, file.path));
  }
}

async function isDirty(cwd: string, untracked: "all" | "no" = "all") {
  const status = await git(cwd, ["status", "--porcelain", "-z", `--untracked-files=${untracked}`]);
  return status !== "";
}

/** The single line by which kozod judges prove; it is always the last line printed. */
export function proveLine(result: ProveResult): string {
  const fields = [`status=${result.status}`];
  if (result.status === "MISCONFIGURED") fields.push(`reason=${result.reason}`);
  if (result.status === "pass" || result.status === "fail") {
    if (result.reason) fields.push(`reason=${result.reason}`);
    fields.push(`tests=${result.runs.reduce((sum, run) => sum + run.files.length, 0)}`);
    fields.push(`reverted=${result.reverted.length}`);
  }
  return `KOZO_PROVE: ${fields.join(" ")}`;
}
