import { describe, expect, test } from "bun:test";
import { cp, rm } from "node:fs/promises";
import { join } from "node:path";
import { kozoHome, lineHash, StateError } from "@kozo/core";
import { recordedLogs, tempDirectory } from "@kozo/testing";
import { EventLogError, EventStore } from "./event-store.ts";

const created = {
  type: "item.created",
  item: "K-1",
  data: { repository: "~/src/shop", title: "Reject a blank quantity", source: "local" },
} as const;

async function lines(path: string) {
  return (await Bun.file(path).text())
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
}

describe("EventStore", () => {
  test("appending stamps increasing ts and per-log seq and writes each log", async () => {
    await using dir = await tempDirectory();
    const home = kozoHome(dir.path);
    const store = await EventStore.open(home);
    await store.append(created);
    await store.append({
      type: "stage.changed",
      item: "K-1",
      data: { target: "item", from: "intake", to: "triage", by: "kozod", reason: "test" },
    });
    await store.append({
      type: "run.started",
      item: "K-1",
      run_id: "r-0001",
      data: {
        agent: "triage",
        model: "claude-sonnet-5-5",
        mode: "local",
        charter_commit: "abc1234",
        factory_commit: null,
        kozo_version: "0.0.0",
        runtime: "sdk",
        request_sha: "0000000000000000000000000000000000000000000000000000000000000000",
      },
    });
    const kozod = await lines(home.eventsLog);
    const run = await lines(join(home.runs, "r-0001", "events.jsonl"));
    expect(kozod.map((event) => event.seq)).toEqual([0, 1]);
    expect(run.map((event) => [event.seq, event.type])).toEqual([[0, "run.started"]]);
    const stamps = [...kozod, ...run].map((event) => event.ts);
    expect([...stamps].sort()).toEqual(stamps);
    expect(new Set(stamps).size).toBe(3);
    expect(store.state.items["K-1"]?.stage).toBe("triage");
    store.close();
  });

  test("an event the state refuses is neither written nor applied", async () => {
    await using dir = await tempDirectory();
    const home = kozoHome(dir.path);
    const store = await EventStore.open(home);
    await store.append(created);
    await expect(
      store.append({
        type: "stage.changed",
        item: "K-1",
        data: { target: "item", from: "intake", to: "planning", by: "kozod", reason: "test" },
      }),
    ).rejects.toThrow(StateError);
    await expect(store.append({ ...created, item: "nope" } as never)).rejects.toThrow();
    expect(await lines(home.eventsLog)).toHaveLength(1);
    expect(store.state.items["K-1"]?.stage).toBe("intake");
    await store.append({
      type: "stage.changed",
      item: "K-1",
      data: { target: "item", from: "intake", to: "triage", by: "kozod", reason: "test" },
    });
    expect((await lines(home.eventsLog)).map((event) => event.seq)).toEqual([0, 1]);
    store.close();
  });

  test("reopening replays the logs and rebuilds the index to match", async () => {
    await using dir = await tempDirectory();
    await cp(recordedLogs("replay-k1"), dir.path, { recursive: true });
    const home = kozoHome(dir.path);
    const store = await EventStore.open(home);
    expect(store.state.items["K-1"]?.stage).toBe("complete");
    const db = store.db;
    expect(db.query("select value from meta where key = 'schema_version'").get()).toEqual({
      value: "1",
    });
    expect(db.query("select ref, stage, shown_stage from items").all()).toEqual([
      { ref: "K-1", stage: "complete", shown_stage: "complete" },
    ]);
    expect(db.query("select ref, stage, revisions from tasks").all()).toEqual([
      { ref: "K-1/t1", stage: "complete", revisions: 0 },
    ]);
    expect(db.query("select ref, agent, state from runs order by ref").all()).toEqual([
      { ref: "r-0001", agent: "triage", state: "succeeded" },
      { ref: "r-0002", agent: "implement", state: "succeeded" },
      { ref: "r-0003", agent: "review", state: "succeeded" },
    ]);
    const count = db.query<{ n: number }, []>("select count(*) as n from events").get();
    expect(count?.n).toBe(32);
    const types = db.query<{ type: string }, []>("select type from events order by id").all();
    expect(types[0]?.type).toBe("item.created");
    expect(types.at(-1)?.type).toBe("stage.changed");

    await store.append({
      type: "stage.changed",
      item: "K-1",
      data: { target: "item", from: "complete", to: "triage", by: "kozod", reason: "test" },
    });
    store.close();
    const reopened = await EventStore.open(home);
    expect(reopened.state.items["K-1"]?.stage).toBe("triage");
    expect(reopened.db.query("select shown_stage from items").get()).toEqual({
      shown_stage: "triage",
    });
    await reopened.rebuildIndex();
    expect(reopened.db.query<{ n: number }, []>("select count(*) as n from events").get()?.n).toBe(
      33,
    );
    reopened.close();
  });

  test("a log that does not replay keeps the store from opening", async () => {
    await using dir = await tempDirectory();
    await cp(recordedLogs("replay-k1"), dir.path, { recursive: true });
    const home = kozoHome(dir.path);
    const text = (await Bun.file(home.eventsLog).text()).trimEnd().split("\n");
    const last = text.pop() ?? "";
    await Bun.write(
      home.eventsLog,
      [...text, last.replace('"to":"complete"', '"to":"handoff"')].join("\n"),
    );
    await expect(EventStore.open(home)).rejects.toThrow("the event logs do not replay");
  });

  test("ending a run seals its log, which then takes no more events", async () => {
    await using dir = await tempDirectory();
    const home = kozoHome(dir.path);
    const store = await EventStore.open(home);
    const run = { item: "K-1", run_id: "r-0001" };
    await store.append(created);
    await store.append({
      ...run,
      type: "run.started",
      data: {
        agent: "triage",
        model: "claude-sonnet-5-5",
        mode: "local",
        charter_commit: "abc1234",
        factory_commit: null,
        kozo_version: "0.0.0",
        runtime: "sdk",
        request_sha: "0000000000000000000000000000000000000000000000000000000000000000",
      },
    });
    await store.append({ ...run, type: "run.changed", data: { from: "running", to: "failed" } });
    const runLog = await Bun.file(join(home.runs, "r-0001", "events.jsonl")).text();
    const own = await lines(home.eventsLog);
    expect(own.at(-1)).toMatchObject({
      type: "log.sealed",
      run_id: null,
      item: "K-1",
      data: { run: "r-0001", lines: 2, last: lineHash(runLog.trimEnd().split("\n")[1] ?? "") },
    });
    await expect(store.append({ ...run, type: "node.enter", data: { kind: "D" } })).rejects.toThrow(
      "run r-0001 is sealed",
    );
    store.close();

    // A seal lost with a crash is written again when the store opens.
    await Bun.write(
      home.eventsLog,
      `${own
        .slice(0, -1)
        .map((line) => JSON.stringify(line))
        .join("\n")}\n`,
    );
    const reopened = await EventStore.open(home);
    expect(reopened.state.runs["r-0001"]?.sealed).toBe(true);
    expect((await lines(home.eventsLog)).at(-1)?.type).toBe("log.sealed");
    reopened.close();
  });

  test("a run log that differs from its seal keeps the store from opening", async () => {
    for (const change of [
      (lines: string[]) => lines.slice(0, -1),
      (lines: string[]) => [...lines, lines.at(-1) ?? ""],
      (lines: string[]) => [
        ...lines.slice(0, -1),
        (lines.at(-1) ?? "").replace("succeeded", "failed"),
      ],
    ]) {
      await using dir = await tempDirectory();
      await cp(recordedLogs("replay-k1"), dir.path, { recursive: true });
      const home = kozoHome(dir.path);
      const path = join(home.runs, "r-0003", "events.jsonl");
      const text = (await Bun.file(path).text()).trimEnd().split("\n");
      await Bun.write(path, `${change(text).join("\n")}\n`);
      await expect(EventStore.open(home)).rejects.toThrow(EventLogError);
    }
    await using dir = await tempDirectory();
    await cp(recordedLogs("replay-k1"), dir.path, { recursive: true });
    await rm(join(dir.path, "runs", "r-0003"), { recursive: true });
    await expect(EventStore.open(kozoHome(dir.path))).rejects.toThrow(
      "runs/r-0003/events.jsonl is missing",
    );
  });

  test("references are reserved one after another", async () => {
    await using dir = await tempDirectory();
    await cp(recordedLogs("replay-k1"), dir.path, { recursive: true });
    const store = await EventStore.open(kozoHome(dir.path));
    expect([store.nextRun(), store.nextRun()]).toEqual(["r-0004", "r-0005"]);
    expect([store.nextLocalItem(), store.nextLocalItem()]).toEqual(["K-2", "K-3"]);
    store.close();
  });
});
