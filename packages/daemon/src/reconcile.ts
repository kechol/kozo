import { isRunOver, type TaskState } from "@kozo/core";
import { GitError, git } from "@kozo/verify";
import { factoryGitEnvironment } from "@kozo/worker";
import type { EventStore } from "./event-store.ts";
import { defaultBranch } from "./repository.ts";
import type { Runner } from "./runner.ts";
import { awaitingMerge } from "./scheduler.ts";
import { taskBranch } from "./worktrees.ts";

async function branchTip(repository: string, branch: string): Promise<string | null> {
  try {
    return (
      await git(repository, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`])
    ).trim();
  } catch (error) {
    if (error instanceof GitError) return null;
    throw error;
  }
}

/** Whether `branch` is in `target`, merged as it is or rebased into patch-equivalent commits. */
async function merged(repository: string, branch: string, target: string): Promise<boolean> {
  try {
    await git(repository, [
      "merge-base",
      "--is-ancestor",
      `refs/heads/${branch}`,
      `refs/heads/${target}`,
    ]);
    return true;
  } catch (error) {
    if (!(error instanceof GitError)) throw error;
  }
  const cherry = await git(repository, ["cherry", `refs/heads/${target}`, `refs/heads/${branch}`]);
  return cherry.trim() !== "" && !cherry.split("\n").some((line) => line.startsWith("+"));
}

/**
 * Follows what happens to the factory's work outside kozod: on start, runs that kozod left
 * running are lost and resume from their checkpoints; every minute, a task awaiting a merge is
 * completed once its branch is merged, held for attention when its branch is deleted unmerged,
 * and sent back to Reviewing when a human committed to it.
 */
export class Reconciler {
  constructor(
    private readonly store: EventStore,
    private readonly runner: Runner,
    private readonly report: (message: string) => void = () => {},
  ) {}

  /** Marks the runs that were running when kozod stopped as lost; their tasks resume later. */
  async recover(): Promise<void> {
    for (const run of Object.values(this.store.state.runs)) {
      if (isRunOver(run.state)) continue;
      await this.store.append({
        type: "run.changed",
        run_id: run.ref,
        item: run.item,
        task: run.task,
        parent_run: run.parent,
        data: { from: run.state, to: "lost", reason: "kozod stopped while the run was going" },
      });
    }
  }

  /** The head that the task's last final verification passed with. */
  private verifiedHead(task: TaskState): string | null {
    const row = this.store.db
      .query<{ line: string }, [string]>(
        "select line from events where task = ? and type = 'node.exit' and json_extract(line, '$.node') = 'final-verify' order by id desc limit 1",
      )
      .get(task.ref);
    const summary = row
      ? (JSON.parse(row.line) as { data: { summary?: string } }).data.summary
      : undefined;
    return summary?.startsWith("verified ") ? summary.slice("verified ".length) : null;
  }

  private async check(task: TaskState) {
    const item = this.store.state.items[task.item];
    if (!item) return;
    const repository = item.repository;
    const branch = taskBranch(task.ref);
    const target = await defaultBranch(repository);
    const tip = await branchTip(repository, branch);
    if (tip === null) {
      if (!task.hold) {
        await this.store.append({
          type: "hold.set",
          item: item.ref,
          task: task.ref,
          data: {
            target: "task",
            hold: "attention",
            reason: `${branch} was deleted without a merge`,
          },
        });
      }
      return;
    }
    if (await merged(repository, branch, target)) {
      await this.runner.complete(task.ref);
      return;
    }
    const verified = this.verifiedHead(task);
    if (verified === null || verified === tip) return;
    const authors = await git(repository, ["log", "--format=%ae", `${verified}..${tip}`]);
    const human = authors
      .split("\n")
      .some((email) => email !== "" && email !== factoryGitEnvironment.GIT_AUTHOR_EMAIL);
    if (human && !task.hold) {
      await this.store.append({
        type: "stage.changed",
        item: item.ref,
        task: task.ref,
        data: { target: "task", from: "handoff", to: "reviewing" },
      });
    }
  }

  /** One pass over the tasks that wait on something outside kozod. */
  async reconcile(): Promise<void> {
    for (const task of Object.values(this.store.state.tasks)) {
      if (!awaitingMerge(this.store.state, task)) continue;
      await this.check(task).catch((error: unknown) =>
        this.report(
          `kozod: reconciling ${task.ref}: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
    }
  }
}
