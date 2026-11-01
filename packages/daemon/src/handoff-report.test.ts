import { describe, expect, test } from "bun:test";
import { handoffReport } from "./handoff-report.ts";

const task = {
  ref: "K-1/t1",
  goal: "Say only N left",
  done_when: ["1 to 3 units say Only N left"],
} as Parameters<typeof handoffReport>[0]["task"];

describe("handoffReport", () => {
  test("takes the newest run report and verdicts, and names the branch to merge", () => {
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
      locale: "en",
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

  test("words its headings and lines in the repository's locale", () => {
    const text = handoffReport({
      itemRef: "K-1",
      item: { title: "Low stock", tasks: ["K-1/t1"] },
      task,
      runs: [],
      stat: "",
      branch: "kozo/k3x9q2/K-1-t1",
      reproduce: false,
      locale: "ja",
    });
    expect(text).toContain("## 理由");
    expect(text).toContain("Low stock（1 件中 1 件目のタスク）");
    expect(text).toContain("（run report がありません）");
    expect(text).toContain("- review: 記録なし");
    expect(text).toContain("変えたテストは、変更がなくても通ります");
    expect(text.trimEnd().endsWith("マージするには: git merge --no-ff kozo/k3x9q2/K-1-t1")).toBe(
      true,
    );
  });
});
