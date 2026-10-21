import { describe, expect, test } from "bun:test";
import { formatReference, parseReference, taskReferenceSchema } from "./reference.ts";

describe("parseReference", () => {
  test("reads each kind of reference", () => {
    expect(parseReference("K-12")).toEqual({ kind: "item", item: { repo: null, number: 12 } });
    expect(parseReference("app#212")).toEqual({
      kind: "item",
      item: { repo: "app", number: 212 },
    });
    expect(parseReference("app#212/t2")).toEqual({
      kind: "task",
      item: { repo: "app", number: 212 },
      task: 2,
    });
    expect(parseReference("K-12/t1")).toEqual({
      kind: "task",
      item: { repo: null, number: 12 },
      task: 1,
    });
    expect(parseReference("r-0193")).toEqual({ kind: "run", run: 193 });
    expect(parseReference("r-12345")).toEqual({ kind: "run", run: 12345 });
  });

  test("formats every reference back to the same text", () => {
    for (const text of ["K-12", "app#212", "app#212/t2", "my.app-2#7/t10", "r-0193", "r-12345"]) {
      const reference = parseReference(text);
      expect(reference).not.toBeNull();
      if (reference) expect(formatReference(reference)).toBe(text);
    }
  });

  test("rejects malformed references", () => {
    for (const text of [
      "",
      "K-0",
      "K-012",
      "k-12",
      "K-12/t0",
      "K-12/t",
      "app#",
      "#212",
      "-app#212",
      "app#212/t2/t3",
      "r-193",
      "r-0000",
      "r-01234",
      "r-0193/t1",
      " K-12",
      "K-12 ",
      `K-${"9".repeat(20)}`,
    ]) {
      expect(parseReference(text)).toBeNull();
    }
  });

  test("a reference schema accepts only its own kind", () => {
    expect(taskReferenceSchema.safeParse("app#212/t2").success).toBe(true);
    expect(taskReferenceSchema.safeParse("app#212").success).toBe(false);
    expect(taskReferenceSchema.safeParse("r-0193").success).toBe(false);
  });
});
