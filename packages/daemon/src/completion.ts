import { join } from "node:path";
import { isClosed, message } from "@kozo/core";
import { CommandStopped, git } from "@kozo/verify";
import { itemDirectory } from "./item-file.ts";
import { layersFor } from "./risk.ts";
import type { Runner } from "./runner.ts";
import { tail } from "./task-run.ts";
import { completeMerged, note } from "./transitions.ts";
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
  const completed = await completeMerged(
    runner.store,
    { item: item.ref, task: taskRef },
    message(result.status === "pass" ? "stage.merged" : "stage.merged-failed", {
      branch: repository.branch,
      level,
    }),
    {
      complete: message("stage.complete"),
      defect:
        result.status === "pass"
          ? null
          : { reason: defect, note: checkNote, back: message("stage.defect") },
    },
  );
  // Held, taken or closed during the check: the next pass, or the human's verb, settles it.
  if (!completed) return;
  await releaseTask(runner.home, repository.path, taskRef, {
    factory: runner.store.factoryId,
    deleteBranch: false,
  });
}
