import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import {
  type ItemState,
  type Locale,
  type Message,
  message,
  render,
  repositoryLocale,
  type TaskState,
} from "@kozo/core";
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
  /** The repository's locale, which the report's own words are in. */
  locale: Locale;
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
  locale,
}: HandoffInputs): string {
  const say = (said: Message) => render(said, locale);
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
    say(message("handoff.why")),
    "",
    say(
      message("handoff.task-of", {
        title: item?.title ?? itemRef,
        index: (item?.tasks.indexOf(task.ref) ?? 0) + 1,
        count: item?.tasks.length ?? 1,
      }),
    ),
    "",
    ...task.done_when.map((condition) => `- ${condition}`),
    "",
    say(message("handoff.what")),
    "",
    report?.summary ?? say(message("handoff.no-report")),
    "",
    ...(report?.changes ?? []).map((change) => `- ${change}`),
    ...(decisions ? ["", say(message("handoff.decisions")), "", decisions] : []),
    "",
    say(message("handoff.scope")),
    "",
    ...(outOfScope.length > 0
      ? outOfScope.map((note) => `- ${note.path ? `${note.path}: ` : ""}${note.note}`)
      : [say(message("handoff.nothing"))]),
    "",
    say(message("handoff.safe")),
    "",
    say(
      message(reproduce ? "handoff.prove-fail" : "handoff.prove-pass", {
        tests: (report?.tests ?? []).join(", ") || "tests",
      }),
    ),
    say(
      verdict.review
        ? message("handoff.review", {
            verdict: verdict.review.verdict,
            summary: verdict.review.summary,
          })
        : message("handoff.review-none"),
    ),
    say(
      verdict.verify
        ? message("handoff.verify", {
            result: verdict.verify.result,
            summary: verdict.verify.summary,
          })
        : message("handoff.verify-none"),
    ),
    "",
    say(message("handoff.verification")),
    "",
    "```text",
    stat.trim(),
    "```",
    "",
    say(message("handoff.merge", { branch })),
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
    locale: repositoryLocale(
      runner.deps.definition.current.factory,
      runner.store.state.items[itemRef]?.repository ?? "",
    ),
  });
  const path = handoffReportPath(runner.home, itemRef, task.ref);
  await mkdir(dirname(path), { recursive: true });
  await Bun.write(path, text);
}
