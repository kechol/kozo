import { describe, expect, test } from "bun:test";
import { eventWriter, exampleCharter } from "@kozo/testing";
import { parseCharter } from "./charter.ts";
import type { Event } from "./event.ts";
import { message } from "./message.ts";
import type { Plan } from "./plan.ts";
import {
  afterReview,
  applyEvent,
  autonomyLevel,
  highestTask,
  inOrder,
  itemStage,
  numberAfter,
  planNeeded,
  replay,
  StateError,
  startBlocker,
  startNeeded,
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
    write(
      "item.created",
      { repository: "~/src/app", title: "Fix", source: "local", class: null, approvals: "level" },
      item,
    ),
    write(
      "stage.changed",
      { target: "item", from: "intake", to: "triage", by: "kozod", reason: "test" },
      item,
    ),
    write("plan.proposed", { plan: accepted }, item),
    write(
      "stage.changed",
      { target: "item", from: "triage", to: "planning", by: "kozod", reason: "test" },
      item,
    ),
    write("plan.accepted", { plan: accepted, by: "human" }, item),
  ];
}

describe("replay", () => {
  test("a defect is a task.defect on a merged task, dated by the first", () => {
    const write = eventWriter();
    const task = { item: "K-1", task: "K-1/t1" };
    const events = [
      ...planned(write),
      write("note.added", { kind: "check", text: "CI failed before the merge" }, task),
    ];
    expect(replay(events).tasks["K-1/t1"]?.defectAt).toBeNull();
    expect(() => replay([...events, write("task.defect", { reason: "too early" }, task)])).toThrow(
      "is not merged",
    );
    const after = eventWriter();
    const merged = [
      ...planned(after),
      after(
        "branch.merged",
        {
          branch: "kozo/k3x9q2/K-1-t1",
          head: "a1b2c3d",
          into: "main",
          commit: null,
          committer: null,
        },
        task,
      ),
    ];
    const first = after("task.defect", { reason: "the gates failed" }, task);
    const state = replay([...merged, first, after("task.defect", { reason: "again" }, task)]);
    expect(state.tasks["K-1/t1"]?.defectAt).toBe(first.ts);
  });

  test("an item keeps the class its request asked for and who accepted its plan", () => {
    const write = eventWriter();
    const asked = replay([
      write(
        "item.created",
        {
          repository: "~/src/app",
          title: "Docs",
          source: "local",
          class: "docs",
          approvals: "level",
        },
        { item: "K-1" },
      ),
    ]);
    expect(asked.items["K-1"]).toMatchObject({ requestedClass: "docs", acceptedBy: null });
    expect(replay(planned()).items["K-1"]).toMatchObject({
      requestedClass: null,
      acceptedBy: "human",
    });
  });

  test("items keep their arrival order until a human moves one, and their tasks follow it", () => {
    const write = eventWriter();
    const created = (ref: string) =>
      write(
        "item.created",
        { repository: "~/src/app", title: ref, source: "local", class: null, approvals: "level" },
        { item: ref },
      );
    const events = [
      ...planned(write, plan(2)),
      created("K-2"),
      created("K-3"),
      write("item.reordered", { before: "K-1" }, { item: "K-3" }),
      write("item.reordered", { before: null }, { item: "K-1" }),
    ];
    const state = replay(events);
    expect(state.order).toEqual(["K-3", "K-2", "K-1"]);
    expect(inOrder(state).tasks.map((task) => task.ref)).toEqual(["K-1/t1", "K-1/t2"]);
    expect(() =>
      replay([...events, write("item.reordered", { before: "K-2" }, { item: "K-2" })]),
    ).toThrow("K-2 cannot move before itself");
    expect(() =>
      replay([...events, write("item.reordered", { before: "K-9" }, { item: "K-2" })]),
    ).toThrow("item K-9 does not exist");
  });

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
      write(
        "stage.changed",
        { target: "task", from: "building", to: "reviewing", by: "kozod", reason: "test" },
        task,
      ),
      write(
        "stage.changed",
        { target: "task", from: "reviewing", to: "building", by: "kozod", reason: "test" },
        task,
      ),
      write(
        "stage.changed",
        { target: "task", from: "building", to: "reviewing", by: "kozod", reason: "test" },
        task,
      ),
      write(
        "stage.changed",
        { target: "task", from: "reviewing", to: "handoff", by: "kozod", reason: "test" },
        task,
      ),
      write(
        "stage.changed",
        { target: "task", from: "handoff", to: "complete", by: "kozod", reason: "test" },
        task,
      ),
      write(
        "stage.changed",
        { target: "item", from: "building", to: "complete", by: "kozod", reason: "test" },
        task,
      ),
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
          kozo_version: "0.0.0",
          runtime: "sdk",
          request_sha: "0000000000000000000000000000000000000000000000000000000000000000",
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

  test("notes are kept on their item, about the item or one of its tasks", () => {
    const write = eventWriter();
    const state = replay([
      ...planned(write),
      write("note.added", { kind: "approval", text: "Go." }, { item: "K-1" }),
      write(
        "note.added",
        { kind: "instruction", text: "Keep 0." },
        { item: "K-1", task: "K-1/t1" },
      ),
    ]);
    expect(state.items["K-1"]?.notes).toMatchObject([
      { target: "K-1", kind: "approval", text: "Go." },
      { target: "K-1/t1", kind: "instruction", text: "Keep 0." },
    ]);
    expect(() =>
      replay([
        ...planned(eventWriter()),
        eventWriter("2026-10-22T00:00:00.000Z")(
          "note.added",
          { kind: "answer", text: "x" },
          { item: "K-1", task: "K-1/t9" },
        ),
      ]),
    ).toThrow("task K-1/t9 does not exist");
  });

  test("an edit renames its item, which must exist", () => {
    const write = eventWriter();
    const edit = { title: "Fix 0 too", request_sha: "d".repeat(64), trusted: false };
    const state = replay([...planned(write), write("item.edited", edit, { item: "K-1" })]);
    expect(state.items["K-1"]?.title).toBe("Fix 0 too");
    expect(() => replay([eventWriter()("item.edited", edit, { item: "K-9" })])).toThrow(
      "item K-9 does not exist",
    );
  });

  test("a factory is created once, and new tasks are numbered after the highest", () => {
    const write = eventWriter();
    const state = replay([write("factory.created", { factory_id: "k3x9q2" }), ...planned(write)]);
    expect(state.factoryId).toBe("k3x9q2");
    expect(() => applyEvent(state, write("factory.created", { factory_id: "a1b2c3" }))).toThrow(
      "the factory is k3x9q2 already",
    );
    const item = state.items["K-1"];
    if (!item) throw new Error("expected the item");
    expect(highestTask({ ...item, tasks: ["K-1/t1", "K-1/t3"] })).toBe(3);
    expect(numberAfter(plan(2), 3).tasks.map((task) => [task.id, task.depends_on])).toEqual([
      ["t4", []],
      ["t5", ["t4"]],
    ]);
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
          kozo_version: "0.0.0",
          runtime: "sdk",
          request_sha: "0000000000000000000000000000000000000000000000000000000000000000",
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
        write(
          "item.created",
          {
            repository: "~/src/app",
            title: "Fix",
            source: "local",
            class: null,
            approvals: "level",
          },
          item,
        ),
        write(
          "stage.changed",
          { target: "item", from: "intake", to: "planning", by: "kozod", reason: "test" },
          item,
        ),
      ]),
    ).toThrow(StateError);
    const later = eventWriter();
    expect(() =>
      replay([
        ...planned(later),
        later(
          "stage.changed",
          { target: "task", from: "reviewing", to: "handoff", by: "kozod", reason: "test" },
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
      write(
        "hold.set",
        {
          target: "task",
          hold: "question",
          by: "kozod",
          reason: message("text", { text: "which label?" }),
        },
        task,
      ),
    ];
    expect(() =>
      replay([
        ...held,
        write(
          "stage.changed",
          { target: "task", from: "building", to: "reviewing", by: "kozod", reason: "test" },
          task,
        ),
      ]),
    ).toThrow("held by question");
    const write2 = eventWriter();
    const cancelled = replay([
      ...planned(write2),
      write2(
        "hold.set",
        {
          target: "task",
          hold: "question",
          by: "kozod",
          reason: message("text", { text: "which label?" }),
        },
        task,
      ),
      write2(
        "stage.changed",
        { target: "task", from: "building", to: "cancelled", by: "kozod", reason: "test" },
        task,
      ),
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
      write(
        "stage.changed",
        { target: "task", from: "building", to: "reviewing", by: "kozod", reason: "test" },
        t1,
      ),
      write(
        "stage.changed",
        { target: "task", from: "reviewing", to: "handoff", by: "kozod", reason: "test" },
        t1,
      ),
    ]);
    const item = state.items["K-1"];
    if (!item) throw new Error("expected the item");
    expect(itemStage(state, item)).toBe("building");
    const t2 = { item: "K-1", task: "K-1/t2" };
    const write2 = eventWriter();
    const later = replay([
      ...planned(write2, plan(2)),
      ...[t1, t2].map((task) =>
        write2(
          "stage.changed",
          { target: "task", from: "building", to: "reviewing", by: "kozod", reason: "test" },
          task,
        ),
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
  test("Plan needed? sends L1 and L2 to Planning, and L3 only for high risk, a split or a codemod", () => {
    expect(planNeeded("level", "L1", plan())).toBe(true);
    expect(planNeeded("level", "L2", plan())).toBe(true);
    expect(planNeeded("level", "L3", plan())).toBe(false);
    expect(planNeeded("level", "L3", plan(1, "high"))).toBe(true);
    expect(planNeeded("level", "L3", plan(2))).toBe(true);
    const codemod = plan();
    codemod.tasks = codemod.tasks.map((task) => ({
      ...task,
      codemod: "npx codemod",
    })) as Plan["tasks"];
    expect(planNeeded("level", "L3", codemod)).toBe(true);
  });

  test("an item whose approvals are always needed waits for both at every level", () => {
    expect(startNeeded("always", "L3")).toBe(true);
    expect(planNeeded("always", "L3", plan())).toBe(true);
    expect(startNeeded("level", "L1")).toBe(true);
    expect(startNeeded("level", "L2")).toBe(false);
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
      write(
        "item.created",
        { repository: "~/src/app", title: "Fix", source: "local", class: null, approvals: "level" },
        item,
      ),
    ];
    expect(() =>
      replay([
        ...created,
        write(
          "hold.set",
          { target: "item", hold: "capacity", by: "kozod", reason: message("text", { text: "x" }) },
          item,
        ),
      ]),
    ).toThrow("a item cannot be held by capacity");
    const write2 = eventWriter();
    const task = { item: "K-1", task: "K-1/t1" };
    expect(() =>
      replay([
        ...planned(write2),
        write2(
          "hold.set",
          { target: "task", hold: "approval", by: "kozod", reason: message("text", { text: "x" }) },
          task,
        ),
      ]),
    ).toThrow("a task cannot be held by approval");
  });

  test("a second hold is an error and a hold clears only by its own kind", () => {
    const write = eventWriter();
    const task = { item: "K-1", task: "K-1/t1" };
    const held = [
      ...planned(write),
      write(
        "hold.set",
        {
          target: "task",
          hold: "question",
          by: "kozod",
          reason: message("text", { text: "which label?" }),
        },
        task,
      ),
    ];
    expect(() =>
      replay([
        ...held,
        write(
          "hold.set",
          { target: "task", hold: "paused", by: "kozod", reason: message("text", { text: "x" }) },
          task,
        ),
      ]),
    ).toThrow("already held by question");
    const write2 = eventWriter();
    expect(() =>
      replay([
        ...planned(write2),
        write2(
          "hold.set",
          {
            target: "task",
            hold: "question",
            by: "kozod",
            reason: message("text", { text: "which?" }),
          },
          task,
        ),
        write2("hold.cleared", { target: "task", hold: "attention", by: "human" }, task),
      ]),
    ).toThrow("not held by attention");
  });

  test("clearing a hold resumes the same stage", () => {
    const write = eventWriter();
    const task = { item: "K-1", task: "K-1/t1" };
    const state = replay([
      ...planned(write),
      write(
        "stage.changed",
        { target: "task", from: "building", to: "reviewing", by: "kozod", reason: "test" },
        task,
      ),
      write(
        "hold.set",
        {
          target: "task",
          hold: "question",
          by: "kozod",
          reason: message("text", { text: "which label?" }),
        },
        task,
      ),
      write("hold.cleared", { target: "task", hold: "question", by: "human" }, task),
      write(
        "stage.changed",
        { target: "task", from: "reviewing", to: "handoff", by: "kozod", reason: "test" },
        task,
      ),
    ]);
    expect(state.tasks["K-1/t1"]).toMatchObject({ stage: "handoff", hold: null });
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
      write(
        "hold.set",
        {
          target: "task",
          hold: "capacity",
          by: "kozod",
          reason: message("text", { text: "budget" }),
        },
        t1,
      ),
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

  test("a task starts at the plan's risk tier and is only ever raised", () => {
    const write = eventWriter();
    const t1 = { item: "K-1", task: "K-1/t1" };
    const base = planned(write, plan(1, "low"));
    expect(replay(base).tasks["K-1/t1"]?.risk).toBe("low");
    const raised = [
      ...base,
      write("risk.raised", { from: "low", to: "normal", reason: "src changed" }, t1),
    ];
    const state = replay(raised);
    expect(state.tasks["K-1/t1"]?.risk).toBe("normal");
    expect(() =>
      applyEvent(state, write("risk.raised", { from: "normal", to: "low", reason: "x" }, t1)),
    ).toThrow("a risk tier only goes up, not from normal to low");
    expect(() =>
      applyEvent(state, write("risk.raised", { from: "low", to: "high", reason: "x" }, t1)),
    ).toThrow("K-1/t1 is rated normal, not low");
  });
});

describe("applyEvent in place", () => {
  test("an event of any type that the state refuses leaves the state exactly as it was", () => {
    const write = eventWriter();
    const state = replay(planned(write));
    const task = { item: "K-1", task: "K-1/t1" };
    const item = { item: "K-1" };
    const run = { item: "K-1", task: "K-1/t1", run_id: "r-0009" };
    const refused: Event[] = [
      write("factory.created", { factory_id: "a1b2c3" }),
      write("factory.created", { factory_id: "a1b2c4" }),
      write(
        "item.created",
        {
          repository: "~/src/app",
          title: "Again",
          source: "local",
          class: null,
          approvals: "level",
        },
        item,
      ),
      write("item.reordered", { before: "K-1" }, item),
      write(
        "item.edited",
        { title: "x", request_sha: "0".repeat(64), trusted: true },
        { item: "K-9" },
      ),
      write(
        "stage.changed",
        { target: "task", from: "reviewing", to: "handoff", by: "kozod", reason: "x" },
        task,
      ),
      write(
        "stage.changed",
        { target: "task", from: "building", to: "intake", by: "kozod", reason: "x" },
        task,
      ),
      write("hold.cleared", { target: "task", hold: "attention", by: "human" }, task),
      write(
        "hold.set",
        {
          target: "task",
          hold: "approval",
          by: "kozod",
          reason: message("text", { text: "x" }),
          approval: "plan",
        },
        task,
      ),
      write("note.added", { kind: "instruction", text: "x" }, { item: "K-1", task: "K-1/t9" }),
      write("plan.proposed", { plan: { ...plan(), item: "K-2" } }, item),
      write("plan.accepted", { plan: plan(), by: "human" }, item),
      write("run.changed", { from: "running", to: "succeeded" }, run),
      write("log.sealed", { run: "r-0009", lines: 1, last: "0".repeat(64) }),
      write(
        "branch.merged",
        { branch: "kozo/x/K-1-t9", head: "abc", into: "main", commit: null, committer: null },
        {
          item: "K-1",
          task: "K-1/t9",
        },
      ),
      write("risk.raised", { from: "low", to: "high", reason: "x" }, task),
      write("task.defect", { reason: "x" }, task),
      write("task.returned", {}, { item: "K-1", task: "K-1/t9" }),
      write("checkpoint", { head: null }, { item: "K-1", task: "K-1/t9" }),
    ];
    // The first factory.created is allowed and sets the ID that refuses the second.
    applyEvent(state, refused[0] as Event);
    for (const event of refused.slice(1)) {
      const before = structuredClone(state);
      expect(() => applyEvent(state, event)).toThrow(StateError);
      expect({ type: event.type, state }).toEqual({ type: event.type, state: before });
    }
  });
});
