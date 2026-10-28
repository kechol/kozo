import {
  autonomyLevel,
  demotionDue,
  demotionKey,
  type Factory,
  finallyVerified,
  isRunOver,
  lowerLevel,
  type TaskState,
  type WorkClass,
} from "@kozo/core";
import { baseOf, branchTip, git, isAncestor } from "@kozo/verify";
import { factoryGitEnvironment } from "@kozo/worker";
import type { EventStore } from "./event-store.ts";
import { lastHandoff } from "./queries.ts";
import { readCharter } from "./repository.ts";
import type { Runner } from "./runner.ts";
import { hold, move } from "./transitions.ts";
import { taskBranch } from "./worktrees.ts";

/** The stable patch IDs of the patches that `git <args>` prints, each with its commit. */
async function patchIds(repository: string, args: readonly string[]): Promise<Map<string, string>> {
  const patches = Bun.spawn(["git", "-c", "core.fsmonitor=false", ...args], {
    cwd: repository,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "ignore",
  });
  const ids = Bun.spawn(["git", "patch-id", "--stable"], {
    cwd: repository,
    stdin: patches.stdout,
    stdout: "pipe",
    stderr: "ignore",
  });
  const [output] = await Promise.all([new Response(ids.stdout).text(), patches.exited, ids.exited]);
  return new Map(
    output
      .split("\n")
      .filter(Boolean)
      .map((line) => line.split(" ") as [string, string]),
  );
}

/**
 * Whether `head` is in `commit`: merged as it is, rebased into patch-equivalent commits, or
 * squashed into one commit whose patch is the whole branch's, as GitHub's default merge does.
 */
async function contains(repository: string, head: string, commit: string): Promise<boolean> {
  if (await isAncestor(repository, head, commit)) return true;
  const cherry = await git(repository, ["cherry", commit, head]);
  if (cherry.trim() !== "" && !cherry.split("\n").some((line) => line.startsWith("+"))) return true;
  const base = (await git(repository, ["merge-base", head, commit])).trim();
  const [branch] = (await patchIds(repository, ["diff", base, head])).keys();
  if (branch === undefined) return false;
  return (await patchIds(repository, ["log", "-p", "--no-merges", `${base}..${commit}`])).has(
    branch,
  );
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
  /** The evidence each class already at L1 was last found due on, by `demotionKey`. */
  private readonly atBottom = new Map<string, string>();

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
    return lastHandoff(this.store.db, task.ref)?.head ?? null;
  }

  private async check(task: TaskState) {
    const item = this.store.state.items[task.item];
    if (!item) return;
    const repository = item.repository;
    const branch = taskBranch(this.store.factoryId, task.ref);
    const { branch: target, ref } = await baseOf(repository, this.mode());
    const tip = await branchTip(repository, branch);
    if (tip === null) {
      await hold(
        this.store,
        { item: item.ref, task: task.ref },
        "attention",
        `${branch} was deleted without a merge`,
      );
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
      await move(
        this.store,
        { item: item.ref, task: task.ref },
        "reviewing",
        `a human committed to ${branch}`,
        { from: "handoff" },
      );
    }
  }

  /** One pass over the tasks that wait on something outside kozod, then over their record. */
  async reconcile(): Promise<void> {
    for (const task of Object.values(this.store.state.tasks)) {
      // A held task may still be merged by a human, who settles the hold that way.
      if (!finallyVerified(this.store.state, task)) continue;
      await this.check(task).catch((error: unknown) =>
        this.report(
          `kozod: reconciling ${task.ref}: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
    }
    await this.demote().catch((error: unknown) =>
      this.report(`kozod: demoting: ${error instanceof Error ? error.message : String(error)}`),
    );
  }

  /**
   * Lowers each class of a repository one level, from the level kozod applies, when its merged
   * diffs since its last demotion call for it; a class at L1 stays.
   */
  async demote(): Promise<void> {
    const state = this.store.state;
    const pairs = new Map<string, { repository: string; workClass: WorkClass }>();
    for (const task of Object.values(state.tasks)) {
      const repository = state.items[task.item]?.repository;
      if (task.merged && repository)
        pairs.set(demotionKey(repository, task.class), { repository, workClass: task.class });
    }
    for (const [key, { repository, workClass }] of pairs) {
      const reason = demotionDue(this.store.state, repository, workClass);
      if (reason === null || this.atBottom.get(key) === reason) continue;
      const charter = await readCharter(repository, this.mode(), this.store.state);
      if (!charter.ok) continue;
      const from = autonomyLevel(charter.charter, workClass);
      const to = lowerLevel(from);
      // A class at L1 has nowhere to go, so the same evidence is not read again each minute.
      if (to === null) {
        this.atBottom.set(key, reason);
        continue;
      }
      await this.store.append({
        type: "factory.demoted",
        data: { repository, class: workClass, from, to, charter_sha: charter.sha, reason },
      });
      this.report(`kozod: lowered ${workClass} in ${repository} from ${from} to ${to}: ${reason}`);
    }
  }
}
