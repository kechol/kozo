import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmod, cp, stat } from "node:fs/promises";
import { join } from "node:path";
import { kozoHome } from "@kozo/core";
import { recordedLogs, type TempDirectory, tempDirectory } from "@kozo/testing";
import { CommandError, type Commands, createApi } from "./api.ts";
import { apiToken } from "./api-token.ts";
import { DashboardSessions } from "./dashboard-session.ts";
import { EventStore } from "./event-store.ts";

const port = 7420;
const token = "a".repeat(64);
let dir: TempDirectory;
let store: EventStore;
const calls: unknown[][] = [];

const commands: Commands = {
  addItem: async (body) => {
    calls.push(["addItem", body]);
    return { ref: "K-2", message: "added K-2" };
  },
  act: async (ref, _reference, verb, body) => {
    calls.push(["act", ref, verb, body]);
    if (verb === "approve") throw new CommandError(409, `${ref} is not waiting for an approval`);
    return { message: `${verb} ${ref}` };
  },
  pauseFactory: async () => ({ message: "paused" }),
  resumeFactory: async () => ({ message: "resumed" }),
  rebuildIndex: async () => ({ message: "rebuilt" }),
  install: async (body) => {
    calls.push(["install", body]);
    return { message: "opened" };
  },
};

beforeAll(async () => {
  dir = await tempDirectory();
  await cp(recordedLogs("replay-k1"), dir.path, { recursive: true });
  store = await EventStore.open(kozoHome(dir.path));
});

afterAll(async () => {
  store.close();
  await dir[Symbol.asyncDispose]();
});

const app = () =>
  createApi({
    store,
    token,
    port,
    mode: "local",
    commands,
    now: () => new Date("2026-10-21T12:00:00.000Z"),
  });

function call(path: string, init: RequestInit & { headers?: Record<string, string> } = {}) {
  return app().request(`http://127.0.0.1:${port}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, host: `127.0.0.1:${port}`, ...init.headers },
  });
}

describe("the local API", () => {
  test("a request without the right token, from a foreign host or origin is refused", async () => {
    expect((await call("/api/status", { headers: { authorization: "" } })).status).toBe(401);
    expect((await call("/api/status", { headers: { authorization: "Bearer nope" } })).status).toBe(
      401,
    );
    expect((await call("/api/status", { headers: { authorization: token } })).status).toBe(401);
    expect((await call("/api/status", { headers: { host: "evil.example.com" } })).status).toBe(421);
    const foreign = await call("/api/factory/pause", {
      method: "POST",
      headers: { origin: "https://evil.example.com" },
    });
    expect(foreign.status).toBe(403);
    const own = await call("/api/factory/pause", {
      method: "POST",
      headers: { origin: `http://localhost:${port}` },
    });
    expect(own.status).toBe(200);
    expect(own.headers.get("access-control-allow-origin")).toBeNull();
  });

  test("status, lists and references come from the index", async () => {
    const status = await (await call("/api/status")).json();
    expect(status).toMatchObject({ mode: "local", paused: false, activeRuns: 0, waiting: 0 });
    const items = await (await call("/api/ls/items")).json();
    expect(items).toMatchObject([
      { ref: "K-1", shown_stage: "complete", class: null, level: null },
    ]);
    const leveled = createApi({
      store,
      token,
      port,
      mode: "local",
      commands,
      repositories: () => ["/src/shop"],
      autonomy: async () => ({ class: "bugfix", level: "L2" }),
    });
    const request = (path: string) =>
      leveled.request(`http://127.0.0.1:${port}${path}`, {
        headers: { authorization: `Bearer ${token}`, host: `127.0.0.1:${port}` },
      });
    // K-1 is complete, so it runs at no level any more.
    expect(await (await request("/api/ls/items")).json()).toMatchObject([
      { ref: "K-1", class: null, level: null },
    ]);
    expect(await (await request("/api/status")).json()).toMatchObject({
      repositories: ["/src/shop"],
    });
    const runs = (await (await call("/api/ls/runs")).json()) as { ref: string }[];
    expect(runs.map((run) => run.ref)).toEqual(["r-0001", "r-0002", "r-0003"]);
    expect(await (await call("/api/ls/inbox")).json()).toEqual([]);
    expect((await call("/api/ls/queues")).status).toBe(400);

    const item = (await (await call("/api/refs/K-1")).json()) as { tasks: unknown[] };
    expect(item).toMatchObject({ kind: "item", item: { ref: "K-1", plan: { item: "K-1" } } });
    expect(item.tasks[0]).toMatchObject({ ref: "K-1/t1", scope: ["src/cart/**"] });
    const run = await (await call("/api/refs/r-0002")).json();
    expect(run).toMatchObject({ kind: "run", events: 12, cost_usd: 0.61 });
    expect((await call("/api/refs/K-9")).status).toBe(404);
    expect((await call("/api/refs/nope")).status).toBe(400);
  });

  test("events stream from Last-Event-ID, then live", async () => {
    const run = { item: "K-1", task: "K-1/t1", run_id: "r-0004" };
    await store.append({
      ...run,
      type: "run.started",
      data: {
        agent: "review",
        model: "claude-sonnet-5-5",
        mode: "local",
        charter_commit: "abc1234",
        factory_commit: null,
        kozo_version: "0.0.0",
        runtime: "sdk",
        request_sha: "0000000000000000000000000000000000000000000000000000000000000000",
      },
    });
    await store.append({ ...run, type: "node.enter", data: { kind: "A" } });
    await store.append({ ...run, type: "agent.message", data: { agent: "review", text: "One." } });
    const response = await call("/api/refs/r-0004/events", { headers: { "last-event-id": "0" } });
    expect(response.headers.get("content-type")).toStartWith("text/event-stream");
    const reader = response.body?.getReader();
    if (!reader) throw new Error("expected a stream");
    let text = "";
    const decoder = new TextDecoder();
    while ((text.match(/^id: /gm) ?? []).length < 3) {
      const chunk = await reader.read();
      text += decoder.decode(chunk.value);
    }
    const ids = [...text.matchAll(/^id: (\d+)$/gm)].map((match) => Number(match[1]));
    expect(ids).toHaveLength(3);
    await store.append({
      type: "agent.message",
      item: "K-1",
      task: "K-1/t1",
      run_id: "r-0004",
      data: { agent: "review", text: "Late note." },
    });
    while (!text.includes("Late note.")) {
      const chunk = await reader.read();
      text += decoder.decode(chunk.value);
    }
    await reader.cancel();

    const resumed = await call("/api/refs/r-0004/events", {
      headers: { "last-event-id": String(ids[2]) },
    });
    const resumedReader = resumed.body?.getReader();
    const first = decoder.decode((await resumedReader?.read())?.value);
    expect(first).toContain("Late note.");
    await resumedReader?.cancel();
  });

  test("writes go to the commands, and a verb the reference does not take is 400", async () => {
    const added = await call("/api/items", {
      method: "POST",
      body: JSON.stringify({ title: "Show low stock" }),
    });
    expect(added.status).toBe(201);
    expect(await added.json()).toEqual({ ref: "K-2", message: "added K-2" });
    expect((await call("/api/items", { method: "POST", body: "{}" })).status).toBe(400);
    expect((await call("/api/items", { method: "POST", body: "{" })).status).toBe(400);

    const said = await call("/api/refs/K-1/t1/say", {
      method: "POST",
      body: JSON.stringify({ text: "Keep zero as Sold out." }),
    });
    expect(said.status).toBe(404);
    const encoded = await call(`/api/refs/${encodeURIComponent("K-1/t1")}/say`, {
      method: "POST",
      body: JSON.stringify({ text: "Keep zero as Sold out." }),
    });
    expect(await encoded.json()).toEqual({ message: "say K-1/t1" });
    expect((await call("/api/refs/r-0002/approve", { method: "POST", body: "{}" })).status).toBe(
      400,
    );
    expect((await call("/api/refs/K-1/take", { method: "POST", body: "{}" })).status).toBe(400);
    expect((await call("/api/refs/K-1/reject", { method: "POST", body: "{}" })).status).toBe(400);
    const conflict = await call("/api/refs/K-1/approve", { method: "POST", body: "{}" });
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toEqual({ error: "K-1 is not waiting for an approval" });
    expect((await call("/api/refs/K-9/say", { method: "POST", body: '{"text":"x"}' })).status).toBe(
      404,
    );
  });
});

describe("apiToken", () => {
  test("is created once, readable only by the owner", async () => {
    await using home = await tempDirectory();
    const paths = kozoHome(home.path);
    const first = await apiToken(paths);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(await apiToken(paths)).toBe(first);
    expect((await stat(paths.apiToken)).mode & 0o777).toBe(0o600);
  });

  test("a token file that others can read or that holds no full token is refused", async () => {
    await using home = await tempDirectory();
    const paths = kozoHome(home.path);
    await Bun.write(paths.apiToken, "\n", { mode: 0o600 });
    await chmod(paths.apiToken, 0o600);
    await expect(apiToken(paths)).rejects.toThrow("does not hold a token");
    await Bun.write(paths.apiToken, `${"b".repeat(64)}\n`);
    await chmod(paths.apiToken, 0o644);
    await expect(apiToken(paths)).rejects.toThrow("readable by others");
  });
});

describe("dashboard sessions", () => {
  test("a code from the API token opens one session for the page's own origin, once", async () => {
    let now = 0;
    const api = createApi({
      store,
      token,
      port,
      mode: "local",
      commands,
      sessions: new DashboardSessions(() => now),
    });
    const host = { host: `127.0.0.1:${port}` };
    const origin = { ...host, origin: `http://127.0.0.1:${port}` };
    const send = (path: string, init: RequestInit & { headers?: Record<string, string> }) =>
      api.request(`http://127.0.0.1:${port}${path}`, init);
    const code = async () => {
      const answer = await send("/api/dashboard/code", {
        method: "POST",
        headers: { ...host, authorization: `Bearer ${token}` },
      });
      return ((await answer.json()) as { code: string }).code;
    };
    const trade = (body: unknown, headers: Record<string, string> = origin) =>
      send("/api/dashboard/session", { method: "POST", headers, body: JSON.stringify(body) });

    const first = await code();
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect((await trade({ code: first }, host)).status).toBe(403);
    expect((await trade({ code: first }, { ...host, origin: "https://example.com" })).status).toBe(
      403,
    );
    const traded = await trade({ code: first });
    expect(traded.status).toBe(200);
    const { token: session } = (await traded.json()) as { token: string };
    expect(session).toMatch(/^[0-9a-f]{64}$/);
    expect((await trade({ code: first })).status).toBe(403);

    const asSession = { ...origin, authorization: `Bearer ${session}` };
    expect((await send("/api/status", { headers: asSession })).status).toBe(200);
    expect((await send("/api/factory/pause", { method: "POST", headers: asSession })).status).toBe(
      200,
    );
    expect((await send("/api/dashboard/code", { method: "POST", headers: asSession })).status).toBe(
      403,
    );
    expect(
      (await send("/api/status", { headers: { ...host, authorization: "Bearer nope" } })).status,
    ).toBe(401);

    const late = await code();
    now += 61_000;
    expect((await trade({ code: late })).status).toBe(403);
  });
});

describe("the detail routes", () => {
  test("evidence is never rendered as a page, and diffs and records belong to tasks", async () => {
    await using files = await tempDirectory();
    const page = join(files.path, "page.html");
    await Bun.write(page, "<script>alert(1)</script>");
    const api = createApi({
      store,
      token,
      port,
      mode: "local",
      commands,
      records: {
        task: async (ref) => (ref === "K-1/t1" ? { costUsd: 0.5 } : null),
        evidence: async (_run, path) =>
          path === "page.html"
            ? { file: Bun.file(page), type: "application/octet-stream", inline: false }
            : null,
      },
    });
    const get = (path: string) =>
      api.request(`http://127.0.0.1:${port}${path}`, {
        headers: { authorization: `Bearer ${token}`, host: `127.0.0.1:${port}` },
      });
    const served = await get("/api/runs/r-0001/evidence/page.html");
    expect(served.status).toBe(200);
    expect(served.headers.get("x-content-type-options")).toBe("nosniff");
    expect(served.headers.get("content-security-policy")).toBe("sandbox; default-src 'none'");
    expect(served.headers.get("content-disposition")).toBe("attachment");
    expect((await get("/api/runs/r-0001/evidence/missing.png")).status).toBe(404);
    expect((await get("/api/runs/nope/evidence/page.html")).status).toBe(400);
    expect(await (await get("/api/refs/K-1%2Ft1/records")).json()).toEqual({ costUsd: 0.5 });
    expect((await get("/api/refs/K-1/records")).status).toBe(400);
    expect((await get("/api/refs/K-1/diff")).status).toBe(400);
    expect((await get("/api/refs/K-1%2Ft1/diff")).status).toBe(404);
  });
});
