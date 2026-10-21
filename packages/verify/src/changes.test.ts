import { describe, expect, test } from "bun:test";
import { globMatcher, protectedPathMatcher } from "./changes.ts";

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

describe("protectedPathMatcher", () => {
  test("a glob also protects everything under what it matches", () => {
    const matches = protectedPathMatcher("src/*");
    expect(matches("src/a.ts")).toBe(true);
    expect(matches("src/auth/session.ts")).toBe(true);
    expect(matches("lib/a.ts")).toBe(false);
  });

  test("a path with brackets is protected as written", () => {
    const matches = protectedPathMatcher("app/[id]");
    expect(matches("app/[id]/page.tsx")).toBe(true);
    expect(matches("app/i/page.tsx")).toBe(true);
    expect(matches("app/other/page.tsx")).toBe(false);
  });
});

describe("globMatcher on a literal path with glob syntax", () => {
  test("matches the path spelled exactly like it, and nothing under it", () => {
    const matches = globMatcher(["src/app/products/[slug]/page.tsx"]);
    expect(matches("src/app/products/[slug]/page.tsx")).toBe(true);
    expect(matches("src/app/products/s/page.tsx")).toBe(true);
    expect(matches("src/app/products/[slug]/page.tsx/x")).toBe(false);
  });
});
