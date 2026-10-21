import { describe, expect, test } from "bun:test";
import { briefSchema } from "./brief.ts";

const brief = {
  version: 1,
  goal: "Show Only N left when 1 to 3 units remain",
  done_when: ['stockLabel(3) returns "Only 3 left"'],
  item: {
    goal: "Tell buyers when stock is low",
    task: "K-12/t1",
    position: 1,
    of: 1,
    prior_diffs: [],
  },
  blueprint: { class: "feature", nodes: ["implement", "gates", "review"] },
  scope: ["src/**"],
  do_not_act: ["Anything outside src/"],
  context: { files: ["src/stock.ts"], decisions: [], rules: [] },
  request: "On the product page, show Only N left when 1 to 3 units remain.",
  gates: "full",
  limits: {
    max_changed_lines: 400,
    max_files: 8,
    max_turns: 40,
    max_minutes: 30,
    max_cost_usd: 5,
  },
  forbidden: ["push", "merge", "protected paths", "existing tests"],
};

describe("briefSchema", () => {
  test("accepts a complete brief", () => {
    expect(briefSchema.safeParse(brief).success).toBe(true);
  });

  test("every field is required and none may be empty", () => {
    for (const field of Object.keys(brief)) {
      const { [field]: _, ...rest } = brief as Record<string, unknown>;
      expect({ field, ok: briefSchema.safeParse(rest).success }).toEqual({ field, ok: false });
    }
    expect(briefSchema.safeParse({ ...brief, goal: "" }).success).toBe(false);
    expect(briefSchema.safeParse({ ...brief, scope: [] }).success).toBe(false);
    expect(briefSchema.safeParse({ ...brief, do_not_act: [] }).success).toBe(false);
  });

  test("the task's position cannot pass the number of tasks", () => {
    expect(briefSchema.safeParse({ ...brief, item: { ...brief.item, position: 2 } }).success).toBe(
      false,
    );
  });

  test("a wrong version or an unknown field is rejected", () => {
    expect(briefSchema.safeParse({ ...brief, version: 2 }).success).toBe(false);
    expect(briefSchema.safeParse({ ...brief, hints: [] }).success).toBe(false);
  });
});
