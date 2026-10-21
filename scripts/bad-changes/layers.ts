import {
  type Judge,
  runDiffGuard,
  runGates,
  runProve,
  runReview,
} from "../../packages/verify/src/index.ts";
import { type BadChange, gitRepository, suiteBase, suiteTask } from "../../testing/src/index.ts";

export interface LayerOutcome {
  gates: string;
  diffGuard: string;
  prove: string;
  /** Present only when a judge was given. */
  review?: string;
}

/** Whether each layer let the change through; anything else means the layer caught it. */
export function caughtBy(outcome: LayerOutcome) {
  return {
    gates: outcome.gates !== "pass",
    "diff-guard": outcome.diffGuard !== "pass",
    prove: outcome.prove !== "pass",
    review: outcome.review !== undefined && outcome.review !== "accept",
  };
}

/**
 * Builds the suite repository with `files` committed on a task branch and runs every layer on
 * it, review only when a judge is given. Layer output is discarded; the statuses are returned.
 */
export async function runLayers(
  files: BadChange["files"],
  judge?: { judge: Judge; model: string },
): Promise<LayerOutcome> {
  await using repo = await gitRepository();
  await repo.commit(suiteBase, "the suite shop");
  await repo.git("switch", "--quiet", "-c", "task");
  await repo.commit(files, "the change under test");
  const quiet = () => {};
  const base = "main";

  const gates = await runGates({ cwd: repo.path, level: "full", log: quiet });
  const diffGuard = await runDiffGuard({
    cwd: repo.path,
    base,
    head: "HEAD",
    scope: suiteTask.scope,
    log: quiet,
  });
  const prove = await runProve({ cwd: repo.path, base, log: quiet });
  const outcome: LayerOutcome = {
    gates: gates.status,
    diffGuard: diffGuard.status,
    prove: prove.status === "fail" ? `fail:${prove.reason}` : prove.status,
  };
  if (judge) {
    const review = await runReview({
      cwd: repo.path,
      base,
      goal: suiteTask.goal,
      doneWhen: suiteTask.doneWhen,
      judge: judge.judge,
      model: judge.model,
      maxCostUsd: 1,
      log: quiet,
    });
    outcome.review = review.status === "reviewed" ? review.record.verdict : "error";
  }
  return outcome;
}
