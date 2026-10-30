import { join } from "node:path";
import { isClosed } from "@kozo/core";
import { git } from "@kozo/verify";
import { itemDirectory } from "./item-file.ts";
import { layersFor } from "./risk.ts";
import type { Runner } from "./runner.ts";
import { tail } from "./task-run.ts";
import { move, note } from "./transitions.ts";
import { releaseTask, worktreePath } from "./worktrees.ts";

/**
 * Complete: a task whose branch is merged has its DONE_WHEN checked with the gates of its
 * risk tier on the merged default branch. A pass completes the task, and the item once every
 * task is complete; a failure is a post-merge defect that sends the item back to Triage.
 */
export async function completeTask(runner: Runner, taskRef: string): Promise<void> {
  const task = runner.store.state.tasks[taskRef];
  const item = task ? runner.store.state.items[task.item] : undefined;
  if (!task || !item?.plan || task.stage !== "handoff" || task.hold) return;
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
  const { result, output } = await runner.recordedGates(
    { item: item.ref, task: taskRef, node: "complete" },
    level,
    worktree,
    repository.base,
    join(itemDirectory(runner.home, item.ref), `check-${taskRef.split("/").at(-1)}.log`),
    { minutes: repository.charter.limits.max_minutes },
  );
  const defect = `the ${level} gates failed on ${repository.branch} after the merge`;
  const recordDefect = async () => {
    await note(
      runner.store,
      { item: item.ref, task: taskRef },
      "check",
      `After the merge, the ${level} gates on ${repository.branch} failed, so DONE_WHEN is not met:\n${tail(output)}`,
    );
    await runner.store.append({
      type: "task.defect",
      item: item.ref,
      task: taskRef,
      data: { reason: defect },
    });
  };
  // A task cancelled when the item was split again, or by a human, waits for nothing.
  const closed = (ref: string) => isClosed(runner.store.state.tasks[ref]?.stage ?? "cancelled");
  const last = item.tasks.every((ref) => ref === taskRef || closed(ref));
  // Before the item's last task the item cannot go back to Triage, so the task waits, and
  // with it every task that depends on it, until a human retries the check or closes it.
  if (result.status !== "pass" && !last) {
    await recordDefect();
    await runner.hold(item.ref, taskRef, "attention", `${defect}; kozo retry checks again`);
    return;
  }
  await runner.moveTask(
    task,
    "complete",
    null,
    `merged into ${repository.branch}; the ${level} gates ${result.status === "pass" ? "passed" : "failed"} there`,
  );
  await releaseTask(runner.home, repository.path, taskRef, {
    factory: runner.store.factoryId,
    deleteBranch: false,
  });
  const owner = runner.store.state.items[item.ref];
  if (!owner?.tasks.every(closed)) return;
  // A defect sends the item straight back to Triage, so it never looks complete, and its
  // Issue is never closed, in between.
  const defective = result.status !== "pass";
  if (defective) await recordDefect();
  await move(
    runner.store,
    { item: item.ref, task: null },
    defective ? "triage" : "complete",
    defective ? "the check after the merge failed, a post-merge defect" : "every task is complete",
    { from: owner.stage },
  );
}
