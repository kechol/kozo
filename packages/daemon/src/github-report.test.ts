import { describe, expect, test } from "bun:test";
import { type FactoryState, type ItemState, message } from "@kozo/core";
import { quiet, statusBody } from "./github-report.ts";

const item = {
  ref: "shop#4",
  stage: "planning",
  tasks: [],
  hold: { kind: "approval", reason: message("hold.plan-approval"), since: "", approval: "plan" },
} as unknown as ItemState;
const state = { items: { [item.ref]: item }, tasks: {} } as unknown as FactoryState;

describe("statusBody", () => {
  test("words the status comment in the repository's locale", () => {
    expect(statusBody(state, item, new Map(), 0.5, "en")).toBe(
      "**kozo**: shop#4 is in planning and waits for approval: plan approval.\n\nCost so far: 0.50 USD",
    );
    expect(statusBody(state, item, new Map(), 0.5, "ja")).toBe(
      "**kozo**: shop#4 は planning にあり、承認を待っています（計画の承認）。\n\nここまでの費用: 0.50 USD",
    );
  });

  test("a mention or a closing keyword in what it quotes does nothing", () => {
    expect(quiet("@owner fixes #3")).not.toContain("@owner");
  });
});
