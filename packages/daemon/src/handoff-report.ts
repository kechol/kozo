import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { ItemState, TaskState } from "@kozo/core";
import { GitError, git } from "@kozo/verify";
import { handoffReportPath } from "./item-file.ts";
import type { Runner } from "./runner.ts";
import { type RunRecord, runRecords } from "./task-records.ts";
import { taskBranch } from "./worktrees.ts";

/** What the handoff report of a task is made of, read from its runs and its worktree. */
export interface HandoffInputs {
  itemRef: string;
  item: Pick<ItemState, "title" | "tasks"> | undefined;
  task: TaskState;
  /** What each implement run left, oldest first. */
  runs: RunRecord[];
  /** `git diff --stat` of the task branch against its base. */
  stat: string;
  branch: string;
  /** Whether the task's blueprint reproduces the problem with a failing test first. */
  reproduce: boolean;
}

/** The handoff report a human reads before merging a task. */
export function handoffReport({
  itemRef,
  item,
  task,
  runs,
  stat,
  branch,
  reproduce,
}: HandoffInputs): string {
  const report = runs.findLast((run) => run.report !== null)?.report ?? null;
  const outOfScope = report?.out_of_scope ?? [];
  const verdict = {
    review: runs.findLast((run) => run.verdict.review)?.verdict.review,
    verify: runs.findLast((run) => run.verdict.verify)?.verdict.verify,
  };
  const decisions = runs
    .map((run) => run.decisions)
    .filter(Boolean)
    .join("\n");
  return [
    `# ${task.ref}: ${task.goal}`,
    "",
    "## Why",
    "",
    `${item?.title ?? itemRef} — task ${(item?.tasks.indexOf(task.ref) ?? 0) + 1} of ${item?.tasks.length ?? 1}.`,
    "",
    ...task.done_when.map((condition) => `- ${condition}`),
    "",
    "## What changed",
    "",
    report?.summary ?? "(no run report)",
    "",
    ...(report?.changes ?? []).map((change) => `- ${change}`),
    ...(decisions ? ["", "Decisions:", "", decisions] : []),
    "",
    "## Out of scope",
    "",
    ...(outOfScope.length > 0
      ? outOfScope.map((note) => `- ${note.path ? `${note.path}: ` : ""}${note.note}`)
      : ["Nothing noted."]),
    "",
    "## Why it is safe",
    "",
    `- prove: the changed tests ${reproduce ? "fail" : "pass"} without the change (${(report?.tests ?? []).join(", ") || "tests"})`,
    `- review: ${verdict.review ? `${verdict.review.verdict} — ${verdict.review.summary}` : "not recorded"}`,
    `- verify: ${verdict.verify ? `${verdict.verify.result} — ${verdict.verify.summary}` : "not run"}`,
    "",
    "## Verification",
    "",
    "```text",
    stat.trim(),
    "```",
    "",
    `Merge it with: git merge --no-ff ${branch}`,
    "",
  ].join("\n");
}

/** Writes the handoff report of `task` from what its runs left and its worktree's diff. */
export async function writeHandoffReport(
  runner: Runner,
  itemRef: string,
  task: TaskState,
  base: string,
  worktree: string,
  reproduce: boolean,
) {
  // A task resumed in a new run left its report and verdicts in the runs before it.
  const runs = await runRecords(runner.home, runner.store.state, task);
  const stat = await git(worktree, ["diff", "--stat", `${base}...HEAD`]).catch((error) =>
    error instanceof GitError ? "" : Promise.reject(error),
  );
  const text = handoffReport({
    itemRef,
    item: runner.store.state.items[itemRef],
    task,
    runs,
    stat,
    branch: taskBranch(runner.store.factoryId, task.ref),
    reproduce,
  });
  const path = handoffReportPath(runner.home, itemRef, task.ref);
  await mkdir(dirname(path), { recursive: true });
  await Bun.write(path, text);
}
