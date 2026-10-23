import { expect, test } from "bun:test";
import { type Plan, replay } from "@kozo/core";
import { eventWriter } from "@kozo/testing";
import { taskOwnerNotes } from "./instructions.ts";

const plan: Plan = {
  version: 1,
  item: "K-1",
  class: "feature",
  risk: "normal",
  approach: "A module, then the pages",
  done_when: ["Prices show in the chosen currency"],
  tasks: [
    {
      id: "t1",
      goal: "Convert prices",
      done_when: ["convert() rounds JPY to whole yen"],
      scope: ["src/lib/currency/**"],
      depends_on: [],
      estimate: { lines: 40, files: 2 },
    },
    {
      id: "t2",
      goal: "Show converted prices",
      done_when: ["The header has a currency switcher"],
      scope: ["src/app/**"],
      depends_on: ["t1"],
      estimate: { lines: 80, files: 4 },
    },
  ],
};

test("a task follows what was said about it, and about its item from its plan on", () => {
  const write = eventWriter();
  const item = { item: "K-1" };
  const state = replay([
    write(
      "item.created",
      {
        repository: "~/src/shop",
        title: "Sell in EUR",
        source: "local",
        class: null,
        approvals: "level",
      },
      item,
    ),
    write(
      "stage.changed",
      { target: "item", from: "intake", to: "triage", by: "kozod", reason: "test" },
      item,
    ),
    write("note.added", { kind: "answer", text: "Add a header switcher too." }, item),
    write("plan.proposed", { plan }, item),
    write(
      "stage.changed",
      { target: "item", from: "triage", to: "planning", by: "kozod", reason: "test" },
      item,
    ),
    write("plan.accepted", { plan, by: "human" }, item),
    write("note.added", { kind: "approval", text: "Keep JPY whole." }, item),
    write(
      "note.added",
      { kind: "instruction", text: "Name it convert." },
      {
        ...item,
        task: "K-1/t1",
      },
    ),
  ]);
  expect(taskOwnerNotes(state, "K-1/t1").map((note) => note.text)).toEqual([
    "Keep JPY whole.",
    "Name it convert.",
  ]);
  expect(taskOwnerNotes(state, "K-1/t2").map((note) => note.text)).toEqual(["Keep JPY whole."]);
});
