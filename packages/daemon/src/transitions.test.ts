import { describe, expect, test } from "bun:test";
import { kozoHome } from "@kozo/core";
import { tempDirectory } from "@kozo/testing";
import { EventStore } from "./event-store.ts";
import { clearHold, hold, move } from "./transitions.ts";

async function storeWithItem() {
  const dir = await tempDirectory();
  const store = await EventStore.open(kozoHome(dir.path));
  await store.append({
    type: "item.created",
    item: "K-1",
    data: {
      repository: "~/src/shop",
      title: "Low stock",
      source: "local",
      class: null,
      approvals: "level",
    },
  });
  return {
    store,
    async [Symbol.asyncDispose]() {
      store.close();
      await dir[Symbol.asyncDispose]();
    },
  };
}

const item = { item: "K-1", task: null };
const holds = (store: EventStore) =>
  store.db
    .query<{ n: number }, []>("select count(*) as n from events where type = 'hold.set'")
    .get()?.n;

describe("transitions", () => {
  test("two holds asked at once hold once, since the look and the append share the queue", async () => {
    await using env = await storeWithItem();
    const both = await Promise.all([
      hold(env.store, item, "attention", "the poll saw it"),
      hold(env.store, item, "question", "the node saw it"),
    ]);
    expect(both).toEqual([true, false]);
    expect(holds(env.store)).toBe(1);
    expect(env.store.state.items["K-1"]?.hold).toMatchObject({ kind: "attention" });
  });

  test("each does nothing when the subject is gone or already as asked", async () => {
    await using env = await storeWithItem();
    expect(await clearHold(env.store, item)).toBe(false);
    expect(await hold(env.store, { item: "K-9", task: null }, "attention", "gone")).toBe(false);
    expect(await hold(env.store, item, "paused", "kozo pause", { by: "human" })).toBe(true);
    expect(await clearHold(env.store, item, { kind: "dependency" })).toBe(false);
    expect(await clearHold(env.store, item, { kind: "paused", by: "human" })).toBe(true);
    expect(await move(env.store, item, "triage", "no approval needed")).toBe(true);
    expect(await move(env.store, item, "triage", "again")).toBe(false);
    expect(env.store.state.items["K-1"]?.stage).toBe("triage");
    // A move from a stage the subject has since left is stale and does nothing.
    expect(await move(env.store, item, "complete", "stale", { from: "intake" })).toBe(false);
    expect(env.store.state.items["K-1"]?.stage).toBe("triage");
  });

  test("a reason is kept to the 2,000 characters an event holds", async () => {
    await using env = await storeWithItem();
    await hold(env.store, item, "attention", "x".repeat(3_000));
    expect(env.store.state.items["K-1"]?.hold?.reason).toHaveLength(2_000);
  });
});
