import { describe, expect, test } from "bun:test";
import { agentNameSchema } from "./work-model.ts";

describe("agentNameSchema", () => {
  // Each agent is a role a model has, and the design invariant in AGENTS.md names every one;
  // a new agent changes the invariant first.
  test("names only the roles the design invariant gives models", () => {
    expect(agentNameSchema.options).toEqual([
      "triage",
      "plan",
      "implement",
      "review",
      "verify",
      "explorer",
    ]);
  });
});
