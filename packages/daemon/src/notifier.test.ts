import { describe, expect, test } from "bun:test";
import { type Factory, kozoHome, message } from "@kozo/core";
import { tempDirectory } from "@kozo/testing";
import { EventStore } from "./event-store.ts";
import { Notifier, osNotify } from "./notifier.ts";

const factory = { locale: "en", budget: { daily_usd: 10 } } as Factory;

async function setup(now: () => Date = () => new Date(), locale: Factory["locale"] = "en") {
  const dir = await tempDirectory();
  const store = await EventStore.open(kozoHome(dir.path));
  const sent: string[] = [];
  const notifier = new Notifier(
    store,
    () => ({ ...factory, locale }),
    async (_title, body) => {
      sent.push(body);
    },
    now,
  );
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
  notifier.start();
  return {
    store,
    notifier,
    sent,
    async [Symbol.asyncDispose]() {
      notifier.stop();
      store.close();
      await dir[Symbol.asyncDispose]();
    },
  };
}

describe("Notifier", () => {
  test("tells of holds that wait on a human and of the factory pausing or refusing on its own", async () => {
    await using env = await setup();
    await env.store.append({
      type: "hold.set",
      item: "K-1",
      data: {
        target: "item",
        hold: "approval",
        by: "kozod",
        reason: message("text", { text: "start approval" }),
        approval: "start",
      },
    });
    await env.store.append({
      type: "hold.cleared",
      item: "K-1",
      data: { target: "item", hold: "approval", by: "human" },
    });
    await env.store.append({
      type: "hold.set",
      item: "K-1",
      data: { target: "item", hold: "paused", by: "human", reason: message("hold.pause") },
    });
    await env.store.during(Bun.randomUUIDv7(), () =>
      env.store.append({ type: "factory.changed", data: { paused: true, reason: "kozo pause" } }),
    );
    await env.store.append({
      type: "factory.changed",
      data: { paused: true, reason: "three sessions in a row failed on the API" },
    });
    await env.store.append({
      type: "factory.refused",
      data: { commit: "abc1234", issues: ["factory.yml: concurrency: Expected int"] },
    });
    await env.notifier.settled();
    expect(env.sent).toEqual([
      "K-1 waits for your approval: start approval",
      "the factory paused: three sessions in a row failed on the API",
      "kozod refused the factory definition: factory.yml: concurrency: Expected int",
    ]);
  });

  test("speaks the factory's locale", async () => {
    await using env = await setup(undefined, "ja");
    await env.store.append({
      type: "hold.set",
      item: "K-1",
      data: {
        target: "item",
        hold: "approval",
        by: "kozod",
        reason: message("text", { text: "start approval" }),
        approval: "start",
      },
    });
    await env.store.append({
      type: "factory.changed",
      data: { paused: true, reason: "three sessions in a row failed on the API" },
    });
    await env.notifier.settled();
    expect(env.sent).toEqual([
      "K-1 があなたの承認を待っています（start approval）",
      "ファクトリーが止まりました（three sessions in a row failed on the API）",
    ]);
  });

  test("tells once of each share of the day's budget the spending crosses", async () => {
    await using env = await setup();
    await env.store.append({
      type: "run.started",
      run_id: "r-0001",
      item: "K-1",
      data: {
        agent: "triage",
        model: "m",
        mode: "local",
        charter_commit: "abc1234",
        factory_commit: null,
        kozo_version: "0.0.0",
        runtime: "sdk",
        request_sha: "0".repeat(64),
      },
    });
    let total = 0;
    for (const usd of [4, 1.5, 1, 2, 3, 1]) {
      total += usd;
      await env.store.append({
        type: "cost.tick",
        run_id: "r-0001",
        item: "K-1",
        data: { usd: total, in: 0, out: 0, cache_read: 0 },
        cost: { usd, in: 0, out: 0, cache_read: 0 },
      });
      await env.notifier.settled();
    }
    expect(env.sent).toEqual([
      "kozo has spent 50 percent of the daily budget of 10 USD",
      "kozo has spent 80 percent of the daily budget of 10 USD",
      "the daily budget of 10 USD is spent; nothing new starts until midnight",
    ]);
  });

  test("reminds of an approval after two, four and six days, once each", async () => {
    let now = new Date();
    await using env = await setup(() => now);
    await env.store.append({
      type: "hold.set",
      item: "K-1",
      data: {
        target: "item",
        hold: "approval",
        by: "kozod",
        reason: message("text", { text: "plan approval" }),
        approval: "plan",
      },
    });
    await env.notifier.settled();
    env.sent.length = 0;
    const since = Date.parse(env.store.state.items["K-1"]?.hold?.since ?? "");
    const day = 24 * 60 * 60 * 1000;
    for (const days of [1, 2.1, 2.5, 4.1, 6.1, 9]) {
      now = new Date(since + days * day);
      await env.notifier.remind();
    }
    expect(env.sent).toEqual([
      "K-1 has waited 2 days for your approval: plan approval",
      "K-1 has waited 4 days for your approval: plan approval",
      "K-1 has waited 6 days for your approval: plan approval",
    ]);
    // An approval given leaves nothing behind to remind of.
    const reminded = (env.notifier as unknown as { reminded: Map<string, number> }).reminded;
    expect(reminded.size).toBe(1);
    await env.store.append({
      type: "hold.cleared",
      item: "K-1",
      data: { target: "item", hold: "approval", by: "human" },
    });
    await env.notifier.remind();
    expect(reminded.size).toBe(0);
  });
});

describe("osNotify", () => {
  test("is silent with KOZO_NOTIFY=off", async () => {
    await osNotify({ KOZO_NOTIFY: "off" })("kozo", "never shown");
  });
});
