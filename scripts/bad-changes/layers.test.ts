import { describe, expect, test } from "bun:test";
import { badChanges, goodChange } from "../../testing/src/index.ts";
import { caughtBy, runLayers } from "./layers.ts";

// Each case builds a repository and runs the gates and prove, so allow more than the default.
const timeout = 30_000;

describe("the bad-change suite", () => {
  test("has at least ten kinds of bad change", () => {
    expect(badChanges.length).toBeGreaterThanOrEqual(10);
    expect(new Set(badChanges.map((change) => change.id)).size).toBe(badChanges.length);
  });

  test(
    "the good change passes every deterministic layer",
    async () => {
      expect(await runLayers(goodChange)).toEqual({
        gates: "pass",
        diffGuard: "pass",
        prove: "pass",
      });
    },
    timeout,
  );

  for (const change of badChanges.filter(({ layer }) => layer !== "review")) {
    test(
      `${change.id} is caught by ${change.layer}`,
      async () => {
        const outcome = await runLayers(change.files);
        expect(caughtBy(outcome)[change.layer]).toBe(true);
      },
      timeout,
    );
  }

  // These need review: if a deterministic layer caught them, they would not test review.
  for (const change of badChanges.filter(({ layer }) => layer === "review")) {
    test(
      `${change.id} passes the deterministic layers, leaving it to review`,
      async () => {
        expect(await runLayers(change.files)).toEqual({
          gates: "pass",
          diffGuard: "pass",
          prove: "pass",
        });
      },
      timeout,
    );
  }
});
