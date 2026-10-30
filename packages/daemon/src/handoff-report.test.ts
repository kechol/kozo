import { describe, expect, test } from "bun:test";
import { handoffReport } from "./handoff-report.ts";

describe("handoffReport", () => {
  test("takes the newest run report and verdicts, and names the branch to merge", () => {
    const task = {
      ref: "K-1/t1",
      goal: "Say only N left",
      done_when: ["1 to 3 units say Only N left"],
    } as Parameters<typeof handoffReport>[0]["task"];
    const text = handoffReport({
      itemRef: "K-1",
      item: { title: "Low stock", tasks: ["K-1/t1"] },
      task,
      runs: [
        {
          run: "r-0001",
          report: { summary: "first try", changes: [], tests: [], out_of_scope: [] },
          verdict: {},
          decisions: "- kept one function",
        },
        {
          run: "r-0002",
          report: null,
          verdict: { review: { verdict: "accept", summary: "Fine." } },
          decisions: "",
        },
      ] as Parameters<typeof handoffReport>[0]["runs"],
      stat: " src/stock.ts | 2 +-\n",
      branch: "kozo/k3x9q2/K-1-t1",
      reproduce: true,
    });
    expect(text).toContain("# K-1/t1: Say only N left");
    expect(text).toContain("Low stock — task 1 of 1.");
    expect(text).toContain("- 1 to 3 units say Only N left");
    expect(text).toContain("first try");
    expect(text).toContain("- kept one function");
    expect(text).toContain("- review: accept — Fine.");
    expect(text).toContain("- verify: not run");
    expect(text).toContain("the changed tests fail without the change");
    expect(text).toContain("src/stock.ts | 2 +-");
    expect(text.trimEnd().endsWith("Merge it with: git merge --no-ff kozo/k3x9q2/K-1-t1")).toBe(
      true,
    );
  });
});
