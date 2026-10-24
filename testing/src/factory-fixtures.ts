import type { Judge, Verifier } from "@kozo/verify";
import { goodChange, suiteTask } from "./bad-changes.ts";
import type { FakeStep } from "./fake-agent.ts";

/** Triage's answer for the suite shop's low-stock request: one bugfix task over `src/`. */
export const suitePlan = {
  outcome: "plan",
  plan: {
    class: "bugfix",
    risk: "normal",
    approach: "Add the low-stock wording to stockLabel and test it",
    done_when: suiteTask.doneWhen,
    tasks: [
      {
        id: "t1",
        goal: suiteTask.goal,
        done_when: suiteTask.doneWhen,
        scope: suiteTask.scope,
        depends_on: [],
        estimate: { lines: 20, files: 2 },
      },
    ],
  },
};

/** The run report of an implement session that made the good change. */
export const suiteReport = {
  version: 1,
  outcome: "done",
  summary: "stockLabel says Only N left for 1 to 3 units.",
  changes: ["Added the low-stock branch to stockLabel"],
  out_of_scope: [],
  tests: ["src/stock-low.test.ts"],
};

/** An implement session that writes, commits and checks the good change, then reports it. */
export const suiteImplement = (): FakeStep[] => [
  { say: "Writing the test first." },
  { write: goodChange },
  { commit: "feat: say only N left when stock is low" },
  { use: "kozo_gates", input: { level: "full" } },
  {
    use: "kozo_note",
    input: { choice: "Kept the label in one function", reason: "It is the only place" },
  },
  { answer: suiteReport },
];

/** A review judge that always gives `verdict`, at a cent a review. */
export const judgeWith = (verdict: "accept" | "revise" | "escalate"): Judge => ({
  async judge(request) {
    return {
      output: { verdict, summary: `${verdict}: the label`, findings: [] },
      model: request.model,
      costUsd: 0.01,
    };
  },
});

/** A verifier for repositories without verify-app, which therefore never runs. */
export const noVerifier: Verifier = {
  async verify() {
    throw new Error("verify-app is missing, so verify never runs");
  },
};
