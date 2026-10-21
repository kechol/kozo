import { describe, expect, test } from "bun:test";
import { runReportJsonSchema, runReportSchema } from "./run-report.ts";

const done = {
  version: 1,
  outcome: "done",
  summary: "Low stock now reads Only N left.",
  changes: ["stockLabel returns Only N left for 1 to 3 units"],
  out_of_scope: [{ path: "src/cart.ts", note: "The total ignores discounts" }],
  tests: ["src/stock-low.test.ts"],
};

const blocked = {
  ...done,
  outcome: "blocked",
  blocked: { reason: "ambiguous", question: "Should 0 units say Sold out or Only 0 left?" },
};

describe("runReportSchema", () => {
  test("accepts a done report and a blocked one", () => {
    expect(runReportSchema.safeParse(done).success).toBe(true);
    expect(runReportSchema.safeParse(blocked).success).toBe(true);
  });

  test("a blocked report needs its reason and question", () => {
    expect(runReportSchema.safeParse({ ...done, outcome: "blocked" }).success).toBe(false);
    expect(
      runReportSchema.safeParse({ ...blocked, blocked: { reason: "ambiguous" } }).success,
    ).toBe(false);
    expect(runReportSchema.safeParse({ ...done, blocked: blocked.blocked }).success).toBe(false);
  });

  test("only a scope block may propose a split", () => {
    const split = [{ goal: "Move the label", done_when: ["It moved"], scope: ["src/**"] }];
    expect(
      runReportSchema.safeParse({
        ...blocked,
        blocked: { reason: "scope", question: "Split it?", split },
      }).success,
    ).toBe(true);
    expect(
      runReportSchema.safeParse({ ...blocked, blocked: { ...blocked.blocked, split } }).success,
    ).toBe(false);
  });

  test("a wrong version or an unknown field is rejected", () => {
    expect(runReportSchema.safeParse({ ...done, version: 2 }).success).toBe(false);
    expect(runReportSchema.safeParse({ ...done, notes: "x" }).success).toBe(false);
  });

  test("the JSON schema lists both outcomes", () => {
    expect(JSON.stringify(runReportJsonSchema)).toContain('"blocked"');
    expect(JSON.stringify(runReportJsonSchema)).toContain('"done"');
  });
});
