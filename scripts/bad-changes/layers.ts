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

/**
 * Whether each layer rejected the change. An error or a misconfiguration is neither a pass nor a
 * catch; `failedToRun` lists the layers that ended that way, so they are reported apart.
 */
export function caughtBy(outcome: LayerOutcome) {
  return {
    gates: outcome.gates === "fail",
    "diff-guard": outcome.diffGuard === "fail",
    prove: outcome.prove.startsWith("fail:"),
    review: outcome.review === "revise" || outcome.review === "escalate",
  };
}

export function failedToRun(outcome: LayerOutcome): string[] {
  const statuses = {
    gates: outcome.gates,
    "diff-guard": outcome.diffGuard,
    prove: outcome.prove,
    review: outcome.review,
  };
  return Object.entries(statuses)
    .filter(([, status]) => status === "error" || status === "MISCONFIGURED")
    .map(([layer]) => layer);
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
