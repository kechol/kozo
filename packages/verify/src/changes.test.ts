import { describe, expect, test } from "bun:test";
import { globMatcher } from "./changes.ts";

describe("globMatcher", () => {
  test("a path without glob syntax covers the file or directory it names", () => {
    const matches = globMatcher(["db/migrations/", "src/auth", "AGENTS.md"]);
    expect(matches("db/migrations/0001.sql")).toBe(true);
    expect(matches("src/auth/session.ts")).toBe(true);
    expect(matches("AGENTS.md")).toBe(true);
    expect(matches("src/authz.ts")).toBe(false);
  });

  test("a pattern with glob syntax keeps its exact meaning", () => {
    const matches = globMatcher(["src/*.test.ts", "tests/**"]);
    expect(matches("src/cart.test.ts")).toBe(true);
    expect(matches("tests/support.ts")).toBe(true);
    expect(matches("src/a.test.ts/impl.ts")).toBe(false);
  });
});
