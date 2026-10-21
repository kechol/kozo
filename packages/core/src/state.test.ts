import { describe, expect, test } from "bun:test";
import { eventWriter, exampleCharter } from "@kozo/testing";
import { parseCharter } from "./charter.ts";
import type { Event } from "./event.ts";
import type { Plan } from "./plan.ts";
import {
  afterReview,
  autonomyLevel,
  expiredApprovals,
  itemStage,
  planNeeded,
  replay,
  StateError,
  startBlocker,
} from "./state.ts";

const plan = (tasks = 1, risk: Plan["risk"] = "normal"): Plan => ({
  version: 1,
  item: "K-1",
  class: "bugfix",
  risk,
  approach: "Fix the label",
  done_when: ["The label is right"],
  tasks: Array.from({ length: tasks }, (_, index) => ({
    id: `t${index + 1}`,
    goal: `Part ${index + 1}`,
    done_when: ["It works"],
    scope: [`src/part${index + 1}/**`],
    depends_on: index === 0 ? [] : ["t1"],
    estimate: { lines: 20, files: 1 },
  })) as Plan["tasks"],
});

/** The events of an item that reaches Building with the given plan. */
function planned(write = eventWriter(), accepted = plan()): Event[] {
  const item = { item: "K-1" };
  return [
    write("item.created", { repository: "~/src/app", title: "Fix", source: "local" }, item),
    write("stage.changed", { target: "item", from: "intake", to: "triage" }, item),
    write("plan.proposed", { plan: accepted }, item),
    write("stage.changed", { target: "item", from: "triage", to: "planning" }, item),
    write("plan.accepted", { plan: accepted, by: "human" }, item),
  ];
}

describe("replay", () => {
  test("an accepted plan creates its tasks in Building", () => {
    const state = replay(planned(eventWriter(), plan(2)));
    const item = state.items["K-1"];
    expect(item?.tasks).toEqual(["K-1/t1", "K-1/t2"]);
    expect(state.tasks["K-1/t2"]?.depends_on).toEqual(["K-1/t1"]);
    expect(state.tasks["K-1/t1"]?.stage).toBe("building");
    expect(item?.draft).toBeNull();
  });

  test("a task moves through review and handoff to Complete, counting revisions", () => {
    const write = eventWriter();
    const task = { item: "K-1", task: "K-1/t1" };
    const state = replay([
      ...planned(write),
      write("stage.changed", { target: "task", from: "building", to: "reviewing" }, task),
      write("stage.changed", { target: "task", from: "reviewing", to: "building" }, task),
      write("stage.changed", { target: "task", from: "building", to: "reviewing" }, task),
      write("stage.changed", { target: "task", from: "reviewing", to: "handoff" }, task),
      write("stage.changed", { target: "task", from: "handoff", to: "complete" }, task),
      write("stage.changed", { target: "item", from: "building", to: "complete" }, task),
    ]);
    expect(state.tasks["K-1/t1"]).toMatchObject({ stage: "complete", revisions: 1 });
    expect(state.items["K-1"]?.stage).toBe("complete");
  });

  test("runs and checkpoints are recorded on their task", () => {
    const write = eventWriter();
    const run = { item: "K-1", task: "K-1/t1", run_id: "r-0001" };
    const state = replay([
      ...planned(write),
      write(
        "run.started",
        {
          agent: "implement",
          model: "claude-sonnet-5-5",
          mode: "local",
          charter_commit: "abc1234",
          factory_commit: null,
        },
        run,
      ),
      write("checkpoint", { head: "def5678" }, { ...run, node: "implement" }),
      write("run.changed", { from: "running", to: "lost" }, run),
    ]);
    expect(state.tasks["K-1/t1"]?.runs).toEqual(["r-0001"]);
    expect(state.tasks["K-1/t1"]?.checkpoint).toMatchObject({ node: "implement", head: "def5678" });
    expect(state.runs["r-0001"]).toMatchObject({ state: "lost", agent: "implement" });
    expect(state.runs["r-0001"]?.endedAt).not.toBeNull();
  });

  test("a sealed run takes no more events", () => {
    const write = eventWriter();
    const run = { item: "K-1", task: "K-1/t1", run_id: "r-0001" };
    const started = [
      ...planned(write),
      write(
        "run.started",
        {
          agent: "implement",
          model: "claude-sonnet-5-5",
          mode: "local",
          charter_commit: "abc1234",
          factory_commit: null,
        },
        run,
      ),
    ];
    const seal = (state: object) =>
      write(
        "log.sealed",
        { run: "r-0001", lines: 2, last: "0".repeat(64) },
        { item: "K-1", ...state },
      );
    expect(() => replay([...started, seal({})])).toThrow("r-0001 is running, not over");
    const ended = [
      ...started,
      write("run.changed", { from: "running", to: "failed" }, run),
      seal({}),
    ];
    expect(replay(ended).runs["r-0001"]?.sealed).toBe(true);
    expect(() => replay([...ended, write("checkpoint", { head: null }, run)])).toThrow(
      "run r-0001 is sealed",
    );
  });

  test("an illegal transition is an error", () => {
    const write = eventWriter();
    const item = { item: "K-1" };
    expect(() =>
      replay([
        write("item.created", { repository: "~/src/app", title: "Fix", source: "local" }, item),
        write("stage.changed", { target: "item", from: "intake", to: "planning" }, item),
      ]),
    ).toThrow(StateError);
    const later = eventWriter();
    expect(() =>
      replay([
        ...planned(later),
        later(
          "stage.changed",
          { target: "task", from: "reviewing", to: "handoff" },
          {
            item: "K-1",
            task: "K-1/t1",
          },
        ),
      ]),
    ).toThrow("K-1/t1 is in building, not reviewing");
  });

  test("a stage does not change under a hold, except to Cancelled", () => {
    const write = eventWriter();
    const task = { item: "K-1", task: "K-1/t1" };
    const held = [
      ...planned(write),
      write("hold.set", { target: "task", hold: "question", reason: "which label?" }, task),
    ];
    expect(() =>
      replay([
        ...held,
        write("stage.changed", { target: "task", from: "building", to: "reviewing" }, task),
      ]),
    ).toThrow("held by question");
    const write2 = eventWriter();
    const cancelled = replay([
      ...planned(write2),
      write2("hold.set", { target: "task", hold: "question", reason: "which label?" }, task),
      write2("stage.changed", { target: "task", from: "building", to: "cancelled" }, task),
    ]);
    expect(cancelled.tasks["K-1/t1"]?.stage).toBe("cancelled");
  });

  test("events out of order are an error", () => {
    const [first, second] = planned();
    if (!first || !second) throw new Error("expected events");
    expect(() => replay([second, first])).toThrow(StateError);
  });

  test("factory pauses are recorded", () => {
    const write = eventWriter();
    const state = replay([write("factory.changed", { paused: true, reason: "kozo pause" })]);
    expect(state).toMatchObject({ paused: true, pausedReason: "kozo pause" });
  });
});

describe("itemStage", () => {
  test("an item shows the stage of its earliest open task", () => {
    const write = eventWriter();
    const t1 = { item: "K-1", task: "K-1/t1" };
    const state = replay([
      ...planned(write, plan(2)),
      write("stage.changed", { target: "task", from: "building", to: "reviewing" }, t1),
      write("stage.changed", { target: "task", from: "reviewing", to: "handoff" }, t1),
    ]);
    const item = state.items["K-1"];
    if (!item) throw new Error("expected the item");
    expect(itemStage(state, item)).toBe("building");
    const t2 = { item: "K-1", task: "K-1/t2" };
    const write2 = eventWriter();
    const later = replay([
      ...planned(write2, plan(2)),
      ...[t1, t2].map((task) =>
        write2("stage.changed", { target: "task", from: "building", to: "reviewing" }, task),
      ),
    ]);
    const laterItem = later.items["K-1"];
    if (laterItem) expect(itemStage(later, laterItem)).toBe("reviewing");
  });

  test("an item before planning shows its own stage", () => {
    const state = replay(planned().slice(0, 2));
    const item = state.items["K-1"];
    if (item) expect(itemStage(state, item)).toBe("triage");
  });
});

describe("branches", () => {
  test("Plan needed? sends L1 and L2 to Planning, and L3 only for high risk or a split", () => {
    expect(planNeeded("L1", plan())).toBe(true);
    expect(planNeeded("L2", plan())).toBe(true);
    expect(planNeeded("L3", plan())).toBe(false);
    expect(planNeeded("L3", plan(1, "high"))).toBe(true);
    expect(planNeeded("L3", plan(2))).toBe(true);
  });

  test("Revision needed? retries a revise up to inner_retries and then asks for attention", () => {
    expect(afterReview("accept", 0, 2)).toEqual({ stage: "handoff" });
    expect(afterReview("revise", 0, 2)).toEqual({ stage: "building" });
    expect(afterReview("revise", 1, 2)).toEqual({ stage: "building" });
    expect(afterReview("revise", 2, 2)).toMatchObject({ hold: "attention" });
    expect(afterReview("revise", 0, 0)).toMatchObject({ hold: "attention" });
    expect(afterReview("escalate", 0, 2)).toMatchObject({ hold: "question" });
  });

  test("the autonomy level of a work class falls back to the default", () => {
    const charter = parseCharter(exampleCharter);
    if (!charter.ok) throw new Error("expected the example Charter");
    expect(autonomyLevel(charter.value, "docs")).toBe("L2");
    expect(autonomyLevel(charter.value, "bugfix")).toBe("L1");
    expect(autonomyLevel(charter.value, null)).toBe("L1");
  });
});

describe("holds", () => {
  test("each hold kind is allowed only on its targets", () => {
    const write = eventWriter();
    const item = { item: "K-1" };
    const created = [
      write("item.created", { repository: "~/src/app", title: "Fix", source: "local" }, item),
    ];
    expect(() =>
      replay([
        ...created,
        write("hold.set", { target: "item", hold: "capacity", reason: "x" }, item),
      ]),
    ).toThrow("a item cannot be held by capacity");
    const write2 = eventWriter();
    const task = { item: "K-1", task: "K-1/t1" };
    expect(() =>
      replay([
        ...planned(write2),
        write2("hold.set", { target: "task", hold: "approval", reason: "x" }, task),
      ]),
    ).toThrow("a task cannot be held by approval");
  });

  test("a second hold is an error and a hold clears only by its own kind", () => {
    const write = eventWriter();
    const task = { item: "K-1", task: "K-1/t1" };
    const held = [
      ...planned(write),
      write("hold.set", { target: "task", hold: "question", reason: "which label?" }, task),
    ];
    expect(() =>
      replay([...held, write("hold.set", { target: "task", hold: "paused", reason: "x" }, task)]),
    ).toThrow("already held by question");
    const write2 = eventWriter();
    expect(() =>
      replay([
        ...planned(write2),
        write2("hold.set", { target: "task", hold: "question", reason: "which?" }, task),
        write2("hold.cleared", { target: "task", hold: "attention", by: "human" }, task),
      ]),
    ).toThrow("not held by attention");
  });

  test("clearing a hold resumes the same stage", () => {
    const write = eventWriter();
    const task = { item: "K-1", task: "K-1/t1" };
    const state = replay([
      ...planned(write),
      write("stage.changed", { target: "task", from: "building", to: "reviewing" }, task),
      write("hold.set", { target: "task", hold: "question", reason: "which label?" }, task),
      write("hold.cleared", { target: "task", hold: "question", by: "human" }, task),
      write("stage.changed", { target: "task", from: "reviewing", to: "handoff" }, task),
    ]);
    expect(state.tasks["K-1/t1"]).toMatchObject({ stage: "handoff", hold: null });
  });

  test("an approval held for seven days has expired", () => {
    const write = eventWriter("2026-10-01T00:00:00.000Z");
    const item = { item: "K-1" };
    const state = replay([
      write("item.created", { repository: "~/src/app", title: "Fix", source: "local" }, item),
      write("hold.set", { target: "item", hold: "approval", reason: "start approval" }, item),
    ]);
    expect(expiredApprovals(state, new Date("2026-10-07T23:59:00.000Z"))).toEqual([]);
    expect(expiredApprovals(state, new Date("2026-10-08T00:00:01.000Z")).map((i) => i.ref)).toEqual(
      ["K-1"],
    );
  });

  test("a hold, a pause or an open dependency keeps a task from starting", () => {
    const write = eventWriter();
    const t1 = { item: "K-1", task: "K-1/t1" };
    const base = planned(write, plan(2));
    const state = replay(base);
    const first = state.tasks["K-1/t1"];
    const second = state.tasks["K-1/t2"];
    if (!first || !second) throw new Error("expected tasks");
    expect(startBlocker(state, first)).toBeNull();
    expect(startBlocker(state, second)).toBe("K-1/t2 waits for K-1/t1");
    const held = replay([
      ...base,
      write("hold.set", { target: "task", hold: "capacity", reason: "budget" }, t1),
    ]);
    const heldFirst = held.tasks["K-1/t1"];
    if (heldFirst) expect(startBlocker(held, heldFirst)).toBe("K-1/t1 is held by capacity");
    const write2 = eventWriter();
    const paused = replay([
      ...planned(write2, plan(2)),
      write2("factory.changed", { paused: true, reason: "kozo pause" }),
    ]);
    const pausedFirst = paused.tasks["K-1/t1"];
    if (pausedFirst) {
      expect(startBlocker(paused, pausedFirst)).toBe("the factory is paused: kozo pause");
    }
  });
});
