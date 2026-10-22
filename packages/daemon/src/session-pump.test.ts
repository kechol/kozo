import { describe, expect, test } from "bun:test";
import { kozoHome } from "@kozo/core";
import { tempDirectory } from "@kozo/testing";
import type { WorkerMessage } from "@kozo/worker";
import { EventStore } from "./event-store.ts";
import { pumpSession } from "./session-pump.ts";

describe("pumpSession", () => {
  test("records only the record types a worker may send, under the run's own envelope", async () => {
    await using dir = await tempDirectory();
    const store = await EventStore.open(kozoHome(dir.path));
    const run = { item: "K-1", task: null, run_id: "r-0001" };
    await store.append({
      type: "item.created",
      item: "K-1",
      data: { repository: "~/src/shop", title: "Low stock", source: "local" },
    });
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
        request_sha: "0".repeat(64),
      },
    });
    const messages = [
      {
        record: {
          type: "stage.changed",
          data: { target: "item", from: "intake", to: "complete", by: "kozod", reason: "x" },
        },
      },
      {
        record: { type: "agent.message", data: { agent: "triage", text: "Hi." }, run_id: "r-0002" },
      },
      { outcome: { status: "failed", reason: "done", costUsd: 0, turns: 1 } },
    ] as unknown as WorkerMessage[];
    const result = await pumpSession(
      store,
      {
        messages: (async function* () {
          yield* messages;
        })(),
        stop() {},
      },
      run,
      1,
    );
    expect(result.status).toBe("failed");
    const types = store.db
      .query<{ type: string; run_id: string | null }, []>(
        "select type, run_id from events order by id",
      )
      .all();
    expect(types).toEqual([
      { type: "factory.created", run_id: null },
      { type: "item.created", run_id: null },
      { type: "run.started", run_id: "r-0001" },
      { type: "agent.message", run_id: "r-0001" },
    ]);
    store.close();
  });

  test("stops the worker when a record cannot be taken", async () => {
    await using dir = await tempDirectory();
    const store = await EventStore.open(kozoHome(dir.path));
    let stopped = false;
    const pumped = pumpSession(
      store,
      {
        messages: (async function* () {
          yield { record: { type: "agent.message", data: { agent: "triage" } } } as WorkerMessage;
        })(),
        stop() {
          stopped = true;
        },
      },
      { item: "K-1", task: null, run_id: "r-0001" },
      1,
    );
    await expect(pumped).rejects.toThrow();
    expect(stopped).toBe(true);
    store.close();
  });
});
