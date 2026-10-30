import { describe, expect, spyOn, test } from "bun:test";
import { cp, rm } from "node:fs/promises";
import { join } from "node:path";
import { kozoHome, StateError, sha256 } from "@kozo/core";
import { recordedLogs, tempDirectory } from "@kozo/testing";
import { EventLogError, EventStore } from "./event-store.ts";
import { lastFailure, lastHandoff, pullsOf } from "./queries.ts";

const created = {
  type: "item.created",
  item: "K-1",
  data: {
    repository: "~/src/shop",
    title: "Reject a blank quantity",
    source: "local",
    class: null,
    approvals: "level",
  },
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
    expect(kozod.map((event) => event.seq)).toEqual([0, 1, 2]);
    expect(kozod[0]).toMatchObject({ type: "factory.created", item: null });
    expect(kozod[0].data.factory_id).toMatch(/^[a-z0-9]{6}$/);
    expect(store.factoryId).toBe(kozod[0].data.factory_id);
    expect(run.map((event) => [event.seq, event.type])).toEqual([[0, "run.started"]]);
    const stamps = [...kozod, ...run].map((event) => event.ts);
    expect([...stamps].sort()).toEqual(stamps);
    expect(new Set(stamps).size).toBe(4);
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
    expect(await lines(home.eventsLog)).toHaveLength(2);
    expect(store.state.items["K-1"]?.stage).toBe("intake");
    await store.append({
      type: "stage.changed",
      item: "K-1",
      data: { target: "item", from: "intake", to: "triage", by: "kozod", reason: "test" },
    });
    expect((await lines(home.eventsLog)).map((event) => event.seq)).toEqual([0, 1, 2]);
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
      value: "4",
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
    expect(count?.n).toBe(33);
    const types = db.query<{ type: string }, []>("select type from events order by id").all();
    expect(types[0]?.type).toBe("factory.created");
    expect(types.at(-1)?.type).toBe("stage.changed");

    await store.append({
      type: "note.added",
      item: "K-1",
      data: { kind: "instruction", text: "test" },
    });
    store.close();
    const reopened = await EventStore.open(home);
    expect(reopened.state.items["K-1"]?.notes.at(-1)?.text).toBe("test");
    expect(reopened.db.query("select shown_stage from items").get()).toEqual({
      shown_stage: "complete",
    });
    await reopened.rebuildIndex();
    expect(reopened.db.query<{ n: number }, []>("select count(*) as n from events").get()?.n).toBe(
      34,
    );
    reopened.close();
  });

  test("the index keeps handoffs, outside writes and a task's last failure, as rebuilt", async () => {
    await using dir = await tempDirectory();
    await cp(recordedLogs("replay-k1"), dir.path, { recursive: true });
    const home = kozoHome(dir.path);
    const store = await EventStore.open(home);
    const task = { item: "K-1", task: "K-1/t1" };
    await store.append({
      ...task,
      type: "external.write",
      data: { target: "github", action: "pull", subject: "https://example.com/pull/1" },
    });
    await store.append({
      ...task,
      type: "handoff.ready",
      node: "final-verify",
      data: { branch: "kozo/x/K-1-t1", head: "abc1234", report: "items/K-1/handoff-t1.md" },
    });
    await store.append({
      ...task,
      type: "node.exit",
      node: "final-verify",
      data: { ok: false, summary: "the deep gates failed" },
    });
    // A later projection of the task keeps the failure the node left.
    await store.append({ ...task, type: "note.added", data: { kind: "instruction", text: "x" } });
    const read = (db: typeof store.db) => ({
      pulls: [...pullsOf(db, "K-1")],
      handoff: lastHandoff(db, "K-1/t1"),
      failure: lastFailure(db, "K-1/t1"),
    });
    const expected = {
      pulls: [["K-1/t1", "https://example.com/pull/1"]] as [string, string][],
      handoff: { branch: "kozo/x/K-1-t1", head: "abc1234", report: "items/K-1/handoff-t1.md" },
      failure: "the deep gates failed",
    };
    expect(read(store.db)).toEqual(expected);
    store.close();
    const reopened = await EventStore.open(home);
    expect(read(reopened.db)).toEqual(expected);
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
      `${[...text, last.replace('"to":"complete"', '"to":"handoff"')].join("\n")}\n`,
    );
    await expect(EventStore.open(home)).rejects.toThrow("the event logs do not replay");
  });

  test("a last line a crash cut short is dropped, and any other broken line still stops it", async () => {
    await using dir = await tempDirectory();
    const home = kozoHome(dir.path);
    const store = await EventStore.open(home);
    await store.append(created);
    store.close();
    const whole = await Bun.file(home.eventsLog).text();
    await Bun.write(home.eventsLog, `${whole}{"v":1,"ts":"2026-`);

    const said = spyOn(console, "error").mockImplementation(() => {});
    const reopened = await EventStore.open(home);
    const calls = [...said.mock.calls];
    said.mockRestore();
    expect(calls).toEqual([
      ["kozod: dropped the last 18 bytes of events.jsonl, a line cut short by a crash"],
    ]);
    expect(reopened.state.items["K-1"]?.title).toBe("Reject a blank quantity");
    expect(await Bun.file(home.eventsLog).text()).toBe(whole);
    await reopened.append({ ...created, item: "K-2" });
    reopened.close();
    expect((await lines(home.eventsLog)).map((event) => event.seq)).toEqual([0, 1, 2]);

    // A line whole but for its newline was cut short too, and was never applied.
    const written = await Bun.file(home.eventsLog).text();
    await Bun.write(home.eventsLog, written.slice(0, -1));
    const quiet = spyOn(console, "error").mockImplementation(() => {});
    const again = await EventStore.open(home);
    quiet.mockRestore();
    expect(again.state.items["K-2"]).toBeUndefined();
    await again.append({ ...created, item: "K-3" });
    again.close();
    expect((await lines(home.eventsLog)).map((event) => event.seq)).toEqual([0, 1, 2]);

    const kept = await Bun.file(home.eventsLog).text();
    await Bun.write(home.eventsLog, `${kept}{"v":1,"ts":"2026-\n`);
    await expect(EventStore.open(home)).rejects.toThrow(EventLogError);
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
      data: { run: "r-0001", lines: 2, last: sha256(runLog.trimEnd().split("\n")[1] ?? "") },
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
