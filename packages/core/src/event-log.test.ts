import { describe, expect, test } from "bun:test";
import { eventWriter } from "@kozo/testing";
import { mergeLogs, parseEventLog, sealIssues, sha256 } from "./event-log.ts";

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
    expect(result.ok && result.value.events.map((event) => event.seq)).toEqual([0, 1]);
    expect(result.ok && result.value.last).toBe(sha256(text.trimEnd().split("\n")[1] ?? ""));
  });

  test("a changed or removed line breaks the hash chain", () => {
    const write = eventWriter();
    const lines = [
      write("factory.changed", { paused: true, reason: "a" }),
      write("factory.changed", { paused: false, reason: "b" }),
      write("factory.changed", { paused: true, reason: "c" }),
    ].map((event) => JSON.stringify(event));
    const changed = [lines[0]?.replace('"a"', '"x"'), lines[1], lines[2]].join("\n");
    const result = parseEventLog(changed, "events.jsonl");
    expect(result.ok ? [] : result.issues).toEqual([
      "events.jsonl:2: prev does not match the line before",
    ]);
    const swapped = [lines[0], lines[2], lines[1]]
      .map((line, index) => line?.replace(/"seq":\d+/, `"seq":${index}`))
      .join("\n");
    expect(parseEventLog(swapped, "events.jsonl").ok).toBe(false);
  });

  test("a log of another event version is one issue, on its first line", () => {
    const old = JSON.stringify({ v: 1, ts: "2026-10-19T09:14:02.311Z" });
    const result = parseEventLog(`${old}\n${old}\n`, "events.jsonl");
    if (result.ok) throw new Error("expected the log to be rejected");
    expect(result.issues).toEqual([
      "events.jsonl:1: the line has event version 1 and this kozo reads only version 2; start the factory again from a new home",
    ]);
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

describe("sealIssues", () => {
  function sealed(lines: number, last: string) {
    const write = eventWriter();
    const run = [
      write(
        "run.started",
        {
          agent: "triage",
          model: "m",
          mode: "local",
          charter_commit: "c",
          factory_commit: null,
          kozo_version: "0.0.0",
          runtime: "sdk",
          request_sha: "0000000000000000000000000000000000000000000000000000000000000000",
        },
        { run_id: "r-0001", item: "K-1" },
      ),
      write("run.changed", { from: "running", to: "succeeded" }, { run_id: "r-0001", item: "K-1" }),
    ];
    const own = [write("log.sealed", { run: "r-0001", lines, last }, { item: "K-1" })];
    return {
      run: { events: run, last: sha256(JSON.stringify(run[1])) },
      own: { events: own, last: sha256(JSON.stringify(own[0])) },
    };
  }

  test("a run log that matches its seal has no issue", () => {
    const { own, run } = sealed(2, sha256(JSON.stringify(sealed(2, "").run.events[1])));
    expect(sealIssues([own, run])).toEqual([]);
  });

  test("a missing, shorter or different run log is an issue", () => {
    const { own, run } = sealed(3, "0".repeat(64));
    expect(sealIssues([own])).toEqual([
      "runs/r-0001/events.jsonl is missing; it was sealed at 2026-10-21T09:00:00.002Z",
    ]);
    expect(sealIssues([own, run])).toEqual([
      "runs/r-0001/events.jsonl does not match its seal: 2 lines, sealed with 3",
    ]);
  });
});
