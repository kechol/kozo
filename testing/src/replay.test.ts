import { describe, expect, test } from "bun:test";
import { cp } from "node:fs/promises";
import { join } from "node:path";
import { itemStage } from "@kozo/core";
import { recordedLogs, replayDirectory } from "./replay.ts";
import { tempDirectory } from "./temp-directory.ts";

describe("replayDirectory", () => {
  test("recorded logs replay into the state they ended in", async () => {
    const state = await replayDirectory(recordedLogs("replay-k1"));
    const item = state.items["K-1"];
    expect(item).toMatchObject({ stage: "complete", hold: null, tasks: ["K-1/t1"] });
    if (item) expect(itemStage(state, item)).toBe("complete");
    expect(state.tasks["K-1/t1"]).toMatchObject({
      stage: "complete",
      revisions: 0,
      runs: ["r-0002", "r-0003"],
      checkpoint: { run: "r-0002", node: "verify-deterministic", head: "9f3c2a1" },
    });
    expect(
      Object.values(state.runs).map((run) => [run.ref, run.agent, run.state, run.parent]),
    ).toEqual([
      ["r-0001", "triage", "succeeded", null],
      ["r-0002", "implement", "succeeded", null],
      ["r-0003", "review", "succeeded", "r-0002"],
    ]);
  });

  test("a malformed line names its log and line", async () => {
    await using copy = await tempDirectory();
    await cp(recordedLogs("replay-k1"), copy.path, { recursive: true });
    const log = join(copy.path, "runs", "r-0002", "events.jsonl");
    const lines = (await Bun.file(log).text()).split("\n");
    lines[2] = lines[2]?.replace('"v":1', '"v":2') ?? "";
    await Bun.write(log, lines.join("\n"));
    await expect(replayDirectory(copy.path)).rejects.toThrow("runs/r-0002/events.jsonl:3: v:");
  });

  test("a missing line breaks the seq count", async () => {
    await using copy = await tempDirectory();
    await cp(recordedLogs("replay-k1"), copy.path, { recursive: true });
    const log = join(copy.path, "events.jsonl");
    const lines = (await Bun.file(log).text()).split("\n");
    lines.splice(1, 1);
    await Bun.write(log, lines.join("\n"));
    await expect(replayDirectory(copy.path)).rejects.toThrow(
      "events.jsonl:2: seq is 2, expected 1",
    );
  });
});
