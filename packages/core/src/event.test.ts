import { describe, expect, test } from "bun:test";
import { type EventType, parseEvent } from "./event.ts";

const envelope = {
  v: 1,
  ts: "2026-10-19T09:14:02.311Z",
  prev: null,
  api_call: null,
  run_id: "r-0193",
  parent_run: null,
  item: "app#212",
  task: "app#212/t1",
  seq: 57,
  node: "gates",
  cost: { usd: 0, in: 0, out: 0, cache_read: 0 },
};

const plan = {
  version: 1,
  item: "app#212",
  class: "bugfix",
  risk: "low",
  approach: "Reject a blank quantity in the cart",
  done_when: ["A blank quantity shows an error"],
  tasks: [
    {
      id: "t1",
      goal: "Reject a blank quantity",
      done_when: ["A blank quantity shows an error"],
      scope: ["src/cart/**"],
      depends_on: [],
      estimate: { lines: 30, files: 2 },
    },
  ],
};

const examples: Record<EventType, unknown> = {
  "run.started": {
    agent: "implement",
    model: "claude-sonnet-5-5",
    mode: "local",
    charter_commit: "4f2a9c1",
    factory_commit: null,
    kozo_version: "0.0.0",
    runtime: "sdk",
    request_sha: "0000000000000000000000000000000000000000000000000000000000000000",
  },
  "session.started": {
    claude_version: "2.3.0",
    model: "claude-sonnet-5-5",
    brief_sha: "b".repeat(64),
    instructions_sha: "c".repeat(64),
  },
  "item.created": {
    repository: "~/src/app",
    title: "Low stock notice",
    source: "local",
    class: null,
  },
  "item.edited": {
    title: "Low stock notice for 0 units",
    request_sha: "d".repeat(64),
    trusted: true,
  },
  "factory.created": { factory_id: "k3x9q2" },
  "factory.changed": { paused: true, reason: "kozo pause" },
  "log.sealed": { run: "r-0193", lines: 58, last: "a".repeat(64) },
  "run.changed": { from: "running", to: "failed", reason: "max_turns" },
  "stage.changed": {
    target: "task",
    from: "building",
    to: "reviewing",
    by: "kozod",
    reason: "test",
  },
  "hold.set": { target: "item", hold: "approval", by: "kozod", reason: "plan approval" },
  "hold.cleared": { target: "item", hold: "approval", by: "human" },
  "note.added": { kind: "answer", text: "Show Sold out for zero." },
  "task.returned": {},
  "item.reordered": { before: null },
  "plan.proposed": { plan },
  "plan.accepted": { plan, by: "kozod" },
  "factory.applied": { commit: "a1b2c3d" },
  "factory.repository": { path: "/src/shop", github: "me/shop" },
  "factory.refused": { commit: "a1b2c3d", issues: ["factory.yml: concurrency: expected a number"] },
  "risk.raised": { from: "low", to: "normal", reason: "the diff changes src/stock.ts" },
  "node.enter": { kind: "D" },
  "node.exit": { ok: false, summary: "unit failed" },
  "agent.message": { agent: "implement", text: "The test now fails before the fix." },
  "tool.call": { call_id: "c1", tool: "gates", input: { level: "fast" } },
  "guard.denied": { call_id: "c2", tool: "Bash", reason: "git push is not allowed" },
  "tool.result": { call_id: "c1", is_error: false, output: "status=pass" },
  "instruction.delivered": { queue_seq: 0, text: "Keep the old label for zero." },
  checkpoint: { head: null },
  "gates.result": {
    level: "full",
    head: "9f3c2a1",
    output_path: "runs/r-0193/gates-verify.log",
    status: "fail",
    failed: "unit",
  },
  "branch.merged": {
    branch: "kozo/k3x9q2/K-12-t1",
    head: "9f3c2a1",
    into: "main",
    commit: "77ab301",
    committer: "Owner <owner@example.com>",
  },
  "handoff.ready": {
    branch: "kozo/k3x9q2/K-12-t1",
    head: "9f3c2a1",
    report: "items/K-12/handoff-t1.md",
  },
  "review.verdict": { verdict: "accept", summary: "The change does what was asked." },
  "external.write": { target: "local", action: "branch", subject: "kozo/k3x9q2/K-12-t1" },
  "cost.tick": { usd: 0.42, in: 12000, out: 800, cache_read: 9000 },
};

const line = (type: string, data: unknown, overrides: object = {}) =>
  JSON.stringify({ ...envelope, type, data, ...overrides });

function issuesOf(text: string) {
  const result = parseEvent(text);
  if (result.ok) throw new Error("expected the event to be rejected");
  return result.issues;
}

describe("parseEvent", () => {
  test("parses an example of every event type", () => {
    for (const [type, data] of Object.entries(examples)) {
      const overrides = type.startsWith("factory.")
        ? { item: null, task: null }
        : type === "log.sealed"
          ? { run_id: null }
          : {};
      const result = parseEvent(line(type, data, overrides));
      expect({ type, ok: result.ok }).toEqual({ type, ok: true });
    }
  });

  test("an unknown type or version is an issue", () => {
    expect(issuesOf(line("run.exploded", {}))[0]).toStartWith("type:");
    expect(issuesOf(line("checkpoint", { head: null }, { v: 2 }))[0]).toStartWith("v:");
  });

  test("an unknown or missing data field is an issue", () => {
    expect(issuesOf(line("checkpoint", { head: null, extra: 1 }))[0]).toStartWith(
      'data: Unrecognized key: "extra"',
    );
    expect(
      issuesOf(line("hold.set", { target: "item", hold: "approval", by: "kozod" }))[0],
    ).toStartWith("data.reason:");
    expect(
      issuesOf(line("hold.set", { target: "item", hold: "blocked", by: "kozod", reason: "x" }))[0],
    ).toStartWith("data.hold:");
  });

  test("the task must belong to the item", () => {
    expect(issuesOf(line("checkpoint", { head: null }, { task: "app#213/t1" }))).toEqual([
      "task: The task is not of this item",
    ]);
    expect(parseEvent(line("checkpoint", { head: null }, { task: null })).ok).toBe(true);
  });

  test("events outside a run and factory-wide events", () => {
    expect(parseEvent(line("hold.set", examples["hold.set"], { run_id: null })).ok).toBe(true);
    expect(issuesOf(line("run.changed", examples["run.changed"], { run_id: null }))).toEqual([
      "run_id: run.changed needs a run",
    ]);
    expect(
      issuesOf(line("hold.set", examples["hold.set"], { run_id: null, parent_run: "r-0001" })),
    ).toEqual(["parent_run: Only a run has a parent"]);
    expect(issuesOf(line("factory.changed", examples["factory.changed"]))).toEqual([
      "item: A factory event has no item",
    ]);
    expect(issuesOf(line("hold.set", examples["hold.set"], { item: null, task: null }))).toEqual([
      "item: hold.set needs an item",
    ]);
    expect(issuesOf(line("log.sealed", examples["log.sealed"]))).toEqual([
      "run_id: A seal goes to kozod's own log",
    ]);
  });

  test("a tool result keeps either its output or a path to it", () => {
    expect(issuesOf(line("tool.result", { call_id: "c1", is_error: false }))).toEqual([
      "data: Give either output or output_path",
    ]);
    expect(
      parseEvent(line("tool.result", { call_id: "c1", is_error: true, output_path: "tool/c1.txt" }))
        .ok,
    ).toBe(true);
  });

  test("a gates result carries what its status needs", () => {
    expect(
      issuesOf(
        line("gates.result", { level: "full", head: "9f3c2a1", output_path: "x", status: "fail" }),
      )[0],
    ).toStartWith("data.failed:");
  });

  test("api_call is a UUID or null", () => {
    expect(issuesOf(line("checkpoint", { head: null }, { api_call: "call-1" }))[0]).toStartWith(
      "api_call:",
    );
    expect(
      parseEvent(line("checkpoint", { head: null }, { api_call: Bun.randomUUIDv7() })).ok,
    ).toBe(true);
  });

  test("prev is a SHA-256 or null", () => {
    expect(issuesOf(line("checkpoint", { head: null }, { prev: "abc" }))[0]).toStartWith("prev:");
    expect(parseEvent(line("checkpoint", { head: null }, { prev: "0".repeat(64) })).ok).toBe(true);
  });

  test("a line that is not JSON is an issue on the document", () => {
    expect(issuesOf('{"v":1,')[0]).toStartWith("<document>: ");
  });
});
