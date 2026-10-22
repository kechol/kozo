import { type Factory, isRunOver, type TaskState } from "@kozo/core";
import { branchTip, git, isAncestor } from "@kozo/verify";
import { factoryGitEnvironment } from "@kozo/worker";
import type { EventStore } from "./event-store.ts";
import { baseOf } from "./repository.ts";
import type { Runner } from "./runner.ts";
import { awaitingMerge } from "./scheduler.ts";
import { taskBranch } from "./worktrees.ts";

/** Whether `head` is in `commit`, merged as it is or rebased into patch-equivalent commits. */
async function contains(repository: string, head: string, commit: string): Promise<boolean> {
  if (await isAncestor(repository, head, commit)) return true;
  const cherry = await git(repository, ["cherry", commit, head]);
  return cherry.trim() !== "" && !cherry.split("\n").some((line) => line.startsWith("+"));
}

/**
 * The first commit on the first-parent line of `target` that holds `head`, and its committer:
 * the merge, the fast-forwarded tip or the commit that applied the rebased or squashed change.
 * Once a commit holds the change, every later one on that line does, so a binary search finds it.
 */
async function mergingCommit(repository: string, head: string, target: string) {
  const line = (await git(repository, ["rev-list", "--first-parent", "--max-count=1000", target]))
    .split("\n")
    .filter(Boolean)
    .reverse();
  let low = 0;
  let high = line.length - 1;
  let found: string | null = null;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const commit = line[middle] ?? "";
    if (await contains(repository, head, commit)) {
      found = commit;
      high = middle - 1;
    } else {
      low = middle + 1;
    }
  }
  if (found === null) return { commit: null, committer: null };
  const committer = (await git(repository, ["log", "-1", "--format=%cn <%ce>", found])).trim();
  return { commit: found, committer };
}

/**
 * Follows what happens to the factory's work outside kozod: on start, runs that kozod left
 * running are lost and resume from their checkpoints; every minute, a task awaiting a merge is
 * completed once its branch is merged, by a check that takes a slot like any run, held for attention when its branch is deleted unmerged,
 * and sent back to Reviewing when a human committed to it.
 */
export class Reconciler {
  constructor(
    private readonly store: EventStore,
    private readonly runner: Runner,
    private readonly report: (message: string) => void = () => {},
    /** Starts the check at Complete within the factory's concurrency; false means later. */
    private readonly startWork: (ref: string, work: () => Promise<void>) => boolean = (_, work) => {
      void work();
      return true;
    },
    /** The factory's mode, which decides where a repository's base is. */
    private readonly mode: () => Factory["mode"] = () => "local",
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

  /** The head that the task was last handed to the human with. */
  private verifiedHead(task: TaskState): string | null {
    const row = this.store.db
      .query<{ head: string }, [string]>(
        "select json_extract(line, '$.data.head') as head from events where task = ? and type = 'handoff.ready' order by id desc limit 1",
      )
      .get(task.ref);
    return row?.head ?? null;
  }

  private async check(task: TaskState) {
    const item = this.store.state.items[task.item];
    if (!item) return;
    const repository = item.repository;
    const branch = taskBranch(this.store.factoryId, task.ref);
    const { branch: target, ref } = await baseOf(repository, this.mode());
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
            by: "kozod",
            reason: `${branch} was deleted without a merge`,
          },
        });
      }
      return;
    }
    if (await contains(repository, `refs/heads/${branch}`, ref)) {
      if (!task.merged) {
        await this.store.append({
          type: "branch.merged",
          item: item.ref,
          task: task.ref,
          data: {
            branch,
            head: tip,
            into: target,
            ...(await mergingCommit(repository, tip, ref)),
          },
        });
      }
      // A task whose check cannot start now is merged still, and the next pass starts it.
      this.startWork(task.ref, () => this.runner.complete(task.ref));
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
        data: {
          target: "task",
          from: "handoff",
          to: "reviewing",
          by: "kozod",
          reason: `a human committed to ${branch}`,
        },
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
