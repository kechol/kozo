import { describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { kozoHome, message, runFiles } from "@kozo/core";
import { said, tempDirectory } from "@kozo/testing";
import { EventStore } from "./event-store.ts";
import { pruneRecords } from "./prune.ts";

async function factory(dir: string) {
  const home = kozoHome(dir);
  const store = await EventStore.open(home);
  for (const item of ["K-1", "K-2"]) {
    await store.append({
      type: "item.created",
      item,
      data: {
        repository: "~/src/shop",
        title: item,
        source: "local",
        class: null,
        approvals: "level",
      },
    });
    await store.append({
      type: "stage.changed",
      item,
      data: {
        target: "item",
        from: "intake",
        to: "triage",
        by: "kozod",
        reason: message("text", { text: "test" }),
      },
    });
    const run = item === "K-1" ? "r-0001" : "r-0002";
    await store.append({
      type: "run.started",
      item,
      run_id: run,
      data: {
        agent: "triage",
        model: "claude-sonnet-5-5",
        mode: "local",
        charter_commit: "abc1234",
        factory_commit: null,
        kozo_version: "0.0.0",
        runtime: "sdk",
        request_sha: "0".repeat(64),
      },
    });
    await store.append({
      type: "run.changed",
      item,
      run_id: run,
      data: { from: "running", to: "succeeded" },
    });
    const files = runFiles(home, run);
    await Bun.write(files.report, "{}");
    await Bun.write(files.verdict, "{}");
    await Bun.write(files.decisions, "chose A");
    await Bun.write(files.brief, "brief");
    await Bun.write(join(files.evidence, "cart.png"), "png");
    await Bun.write(join(files.dir, "gates-final.log"), "log");
  }
  await store.append({
    type: "stage.changed",
    item: "K-1",
    data: {
      target: "item",
      from: "triage",
      to: "complete",
      by: "human",
      reason: message("text", { text: "test" }),
    },
  });
  return { home, store };
}

const later = (days: number) => new Date(Date.now() + days * 24 * 60 * 60 * 1000);

describe("pruneRecords", () => {
  test("prunes the runs of items closed long enough ago to their logs and verdicts", async () => {
    await using dir = await tempDirectory();
    const { home, store } = await factory(dir.path);
    const listed = await pruneRecords(home, store, 30, true, later(31));
    expect(listed.runs).toEqual(["r-0001"]);
    expect(said(listed)).toStartWith("would prune 1 runs");
    expect((await readdir(runFiles(home, "r-0001").dir)).length).toBe(7);

    expect((await pruneRecords(home, store, 30, false, later(29))).runs).toEqual([]);
    const pruned = await pruneRecords(home, store, 30, false, later(31));
    expect(pruned.runs).toEqual(["r-0001"]);
    expect((await readdir(runFiles(home, "r-0001").dir)).sort()).toEqual([
      "decisions.md",
      "events.jsonl",
      "report.json",
      "verdict.json",
    ]);
    // The open item keeps everything, and a pruned run has nothing more to remove.
    expect((await readdir(runFiles(home, "r-0002").dir)).length).toBe(7);
    expect((await pruneRecords(home, store, 30, false, later(31))).runs).toEqual([]);
    const events = (await Bun.file(home.eventsLog).text())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(
      events.filter((event) => event.type === "factory.pruned").map((event) => event.data.runs),
    ).toEqual([["r-0001"]]);
    await store.rebuildIndex();
    expect(store.state.runs["r-0001"]?.state).toBe("succeeded");
    store.close();
  });
});
