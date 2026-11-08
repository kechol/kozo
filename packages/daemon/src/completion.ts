import { appendFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type ItemState,
  isClosed,
  type Message,
  message,
  proseLanguage,
  repositoryLocale,
  runFiles,
} from "@kozo/core";
import {
  CommandStopped,
  git,
  modelFor,
  runVerify,
  SessionStopped,
  verifyInstructions,
  writeVerifyVerdict,
} from "@kozo/verify";
import { itemDirectory } from "./item-file.ts";
import { discardChanges } from "./nodes.ts";
import { layersFor } from "./risk.ts";
import type { Runner } from "./runner.ts";
import { type Repository, tail } from "./task-run.ts";
import { completeMerged, hold, note } from "./transitions.ts";
import { releaseTask, worktreePath } from "./worktrees.ts";

/**
 * Complete: a task whose branch is merged has its DONE_WHEN checked with the gates of its
 * risk tier on the merged default branch. A pass completes the task, and the item once every
 * task is complete; a failure is a post-merge defect that sends the item back to Triage.
 */
export async function completeTask(
  runner: Runner,
  taskRef: string,
  signal: AbortSignal,
): Promise<void> {
  const task = runner.store.state.tasks[taskRef];
  const item = task ? runner.store.state.items[task.item] : undefined;
  // A held item changes no stage, so its task waits for the hold; the scheduler starts the
  // check once it clears.
  if (!task || !item?.plan || task.stage !== "handoff" || task.hold || item.hold) return;
  const repository = await runner.repository(item.repository);
  const worktree = worktreePath(runner.home, repository.path, taskRef);
  const level = layersFor[task.risk].gates;
  await git(worktree, [
    "-c",
    "core.hooksPath=/dev/null",
    "checkout",
    "--quiet",
    "--detach",
    repository.tip,
  ]);
  const checked = await runner
    .recordedGates(
      { item: item.ref, task: taskRef, node: "complete" },
      level,
      worktree,
      repository.base,
      join(itemDirectory(runner.home, item.ref), `check-${taskRef.split("/").at(-1)}.log`),
      { minutes: repository.charter.limits.max_minutes, signal },
    )
    .catch((error: unknown) => {
      if (error instanceof CommandStopped) return null;
      throw error;
    });
  // A human who closes or takes the task stops the check, which their verb settles.
  if (!checked) return;
  const { result, output } = checked;
  // Gates that cannot run say nothing of the merged code, so this is no defect: a human fixes
  // the constraints, and retry runs the check again.
  if (result.status === "MISCONFIGURED") {
    await runner.hold(
      item.ref,
      taskRef,
      "attention",
      message("hold.gates-misconfigured", { level, reason: result.reason }),
    );
    return;
  }
  const defect = message("defect.gates", { level, branch: repository.branch });
  const checkNote = message("note.check-failed", {
    level,
    branch: repository.branch,
    output: tail(output),
  });
  // A task cancelled when the item was split again, or by a human, waits for nothing.
  const closed = (ref: string) => isClosed(runner.store.state.tasks[ref]?.stage ?? "cancelled");
  const last = item.tasks.every((ref) => ref === taskRef || closed(ref));
  // Before the item's last task the item cannot go back to Triage, so the task waits, and
  // with it every task that depends on it, until a human retries the check or closes it.
  if (result.status !== "pass" && !last) {
    await note(runner.store, { item: item.ref, task: taskRef }, "check", checkNote);
    await runner.store.append({
      type: "task.defect",
      item: item.ref,
      task: taskRef,
      data: { reason: defect },
    });
    await runner.hold(item.ref, taskRef, "attention", message("hold.defect", { defect }));
    return;
  }
  // An item of several tasks is checked as a whole once its last one passes, since each task's
  // verify-app saw it without the others.
  const done = item.tasks.filter((ref) => runner.store.state.tasks[ref]?.stage !== "cancelled");
  const accepted =
    result.status === "pass" && last && done.length >= 2
      ? await acceptItem(runner, item, worktree, repository, signal)
      : ({ kind: "skipped" } as const);
  if (accepted === null) return;
  if (accepted.kind === "blocked") {
    await hold(runner.store, { item: item.ref, task: null }, "attention", accepted.reason);
    return;
  }
  const completed = await completeMerged(
    runner.store,
    { item: item.ref, task: taskRef },
    message(result.status === "pass" ? "stage.merged" : "stage.merged-failed", {
      branch: repository.branch,
      level,
    }),
    {
      complete: message("stage.complete"),
      back:
        result.status !== "pass"
          ? { note: checkNote, reason: message("stage.defect"), defect }
          : accepted.kind === "fail"
            ? {
                note: accepted.note,
                reason: message("stage.acceptance-failed", { branch: repository.branch }),
                defect: null,
              }
            : null,
    },
  );
  // Held, taken or closed during the check: the next pass, or the human's verb, settles it.
  if (!completed) return;
  await releaseTask(runner.home, repository.path, taskRef, {
    factory: runner.store.factoryId,
    deleteBranch: false,
  });
}

type Acceptance =
  | { kind: "pass" | "skipped" }
  | { kind: "fail"; note: Message }
  | { kind: "blocked"; reason: Message };

/**
 * Runs verify-app on the merged default branch, checked out in the last task's worktree, against
 * the item's DONE_WHEN, as a run of the item. Resolves to null when a human's stop ended it.
 */
async function acceptItem(
  runner: Runner,
  item: ItemState,
  worktree: string,
  repository: Repository,
  signal: AbortSignal,
): Promise<Acceptance | null> {
  const definition = runner.deps.definition.current;
  const doneWhen = item.plan?.done_when ?? [];
  const run = await runner.startRun(
    { item: item.ref, task: null },
    "verify",
    repository.tip,
    definition,
  );
  const logPath = join(itemDirectory(runner.home, item.ref), "accept.log");
  const verified = await runVerify({
    cwd: worktree,
    base: repository.base,
    goal: item.title,
    doneWhen,
    language: proseLanguage(repositoryLocale(definition.factory, repository.path)),
    verifier: runner.deps.verifier,
    model: modelFor(definition, "verify"),
    instructions: verifyInstructions(definition.agents.verify, definition.verifyApp),
    maxCostUsd: repository.charter.limits.max_cost_usd,
    signal,
    log: (text) => void appendFile(logPath, text).catch(() => {}),
  })
    .catch(async (error: unknown) => {
      if (!(error instanceof SessionStopped)) throw error;
      await runner.endRun(run, "stopped", undefined, error.costUsd);
      return null;
    })
    .finally(() => discardChanges(worktree));
  if (verified === null) return null;
  if (verified.status === "MISCONFIGURED") {
    await runner.endRun(run, "succeeded", message("run.no-verify-app"));
    return { kind: "skipped" };
  }
  if (verified.status === "error") {
    const error = message("text", { text: verified.message });
    await runner.endRun(run, "failed", error, verified.costUsd);
    return { kind: "blocked", reason: message("hold.acceptance-blocked", { reason: error }) };
  }
  const { record } = verified;
  await writeVerifyVerdict(runFiles(runner.home, run).dir, worktree, record).catch(() => "");
  await runner.endRun(run, "succeeded", undefined, record.costUsd);
  if (record.result === "pass") return { kind: "pass" };
  const summary = message("text", { text: record.summary });
  if (record.result === "blocked")
    return { kind: "blocked", reason: message("hold.acceptance-blocked", { reason: summary }) };
  const unmet = record.conditions.filter((condition) => !condition.met);
  return {
    kind: "fail",
    note: message("note.acceptance-failed", {
      branch: repository.branch,
      conditions: unmet
        .map((condition) => `${condition.condition}: ${condition.observation}`)
        .join("; "),
      summary,
    }),
  };
}
