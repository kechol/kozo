import { describe, expect, test } from "bun:test";
import { eventWriter } from "@kozo/testing";
import { mergeLogs, parseEventLog } from "./event-log.ts";

describe("parseEventLog", () => {
  test("parses every line and ignores the final newline", () => {
    const write = eventWriter();
    const text = `${[
      write("factory.changed", { paused: true, reason: "kozo pause" }),
      write("factory.changed", { paused: false, reason: "kozo resume" }),
    ]
      .map((event) => JSON.stringify(event))
      .join("\n")}\n`;
    const result = parseEventLog(text, "events.jsonl");
    expect(result.ok && result.value.map((event) => event.seq)).toEqual([0, 1]);
  });

  test("an issue names the log and the line", () => {
    const result = parseEventLog("{}\n", "runs/r-0001/events.jsonl");
    if (result.ok) throw new Error("expected the log to be rejected");
    expect(result.issues[0]).toStartWith("runs/r-0001/events.jsonl:1: ");
  });
});

describe("mergeLogs", () => {
  test("orders the events of several logs by ts", () => {
    const write = eventWriter();
    const first = write("factory.changed", { paused: true, reason: "a" });
    const second = write("factory.changed", { paused: false, reason: "b" });
    const third = write("factory.changed", { paused: true, reason: "c" });
    expect(mergeLogs([[second], [first, third]])).toEqual([first, second, third]);
  });
});
