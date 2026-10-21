import { describe, expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { kozoHome } from "@kozo/core";
import {
  fakeAgent,
  gitRepository,
  goodChange,
  suiteBase,
  suiteTask,
  tempDirectory,
} from "@kozo/testing";
import { Daemon } from "./daemon.ts";
import { inProcessLauncher } from "./launcher.ts";

describe("Daemon", () => {
  test("serves the local API on 127.0.0.1 with the home's token, and only once per home", async () => {
    await using dir = await tempDirectory();
    const home = kozoHome(dir.path);
    const daemon = await Daemon.start({ home, port: 0 });
    try {
      expect(await Bun.file(home.pidFile).text()).toBe(`${process.pid}\n`);
      await Bun.write(home.pidFile, "1\n");
      await expect(Daemon.start({ home, port: 0 })).rejects.toThrow("already running as pid 1");
    } finally {
      await daemon.stop();
    }
    expect(await Bun.file(home.pidFile).exists()).toBe(false);
  });

  test("answers status over HTTP", async () => {
    await using dir = await tempDirectory();
    const home = kozoHome(dir.path);
    const port = 17000 + Math.floor(Math.random() * 1000);
    const daemon = await Daemon.start({ home, port });
    try {
      const token = (await Bun.file(home.apiToken).text()).trim();
      const response = await fetch(`http://127.0.0.1:${port}/api/status`, {
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ mode: "local", paused: false });
      const rebuilt = await fetch(`http://127.0.0.1:${port}/api/admin/db-rebuild`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
      });
      expect(await rebuilt.json()).toEqual({ message: "rebuilt kozo.db from the event logs" });
    } finally {
      await daemon.stop();
    }
  });

  test("a run that was going when kozod stopped resumes from its checkpoint at the next start", async () => {
    await using repo = await gitRepository();
    await repo.commit(suiteBase, "the suite shop");
    await using dir = await tempDirectory();
    const home = kozoHome(dir.path);
    await mkdir(home.factory, { recursive: true });
    await Bun.write(
      join(home.factory, "factory.yml"),
      `repositories:\n  - { path: ${repo.path} }\n`,
    );
    const triage = {
      outcome: "plan",
      plan: {
        class: "docs",
        risk: "low",
        approach: "Say only N left",
        done_when: suiteTask.doneWhen,
        tasks: [
          {
            id: "t1",
            goal: suiteTask.goal,
            done_when: suiteTask.doneWhen,
            scope: suiteTask.scope,
            depends_on: [],
            estimate: { lines: 20, files: 2 },
          },
        ],
      },
    };
    const port = 19000 + Math.floor(Math.random() * 500);
    const first = await Daemon.start({
      home,
      port,
      tickMs: 50,
      launcher: inProcessLauncher(
        fakeAgent((request) =>
          request.agent === "triage" ? [{ answer: triage }] : [{ hang: true }],
        ),
      ),
    });
    const token = (await Bun.file(home.apiToken).text()).trim();
    const post = (path: string, body: unknown) =>
      fetch(`http://127.0.0.1:${port}${path}`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
    await post("/api/items", { title: "Low stock", class: "docs" });
    while (first.store.state.items["K-1"]?.hold?.reason !== "plan approval") await Bun.sleep(20);
    await post("/api/refs/K-1/approve", {});
    while (first.store.state.items["K-1"]?.stage !== "building") await Bun.sleep(20);
    // Each API write tags its own events; what the scheduler starts afterwards is untagged.
    const calls = first.store.db
      .query<{ type: string; call: string | null }, []>(
        "select type, json_extract(line, '$.api_call') as call from events order by id",
      )
      .all();
    const added = calls.find((event) => event.type === "item.created")?.call;
    const approved = calls.find((event) => event.type === "plan.accepted")?.call;
    expect(added).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/);
    expect(approved).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/);
    expect(calls.filter((event) => event.call === approved).map((event) => event.type)).toEqual([
      "hold.cleared",
      "plan.accepted",
    ]);
    expect(calls.find((event) => event.type === "run.started")?.call).toBeNull();
    while (first.store.state.tasks["K-1/t1"]?.checkpoint?.node !== "implement") await Bun.sleep(20);
    await first.stop();

    const second = await Daemon.start({
      home,
      port,
      tickMs: 50,
      launcher: inProcessLauncher(
        fakeAgent([
          { write: goodChange },
          { commit: "feat: low stock" },
          { tool: "Bash", input: { command: "unused" }, output: "" },
          {
            answer: {
              version: 1,
              outcome: "done",
              summary: "s",
              changes: [],
              out_of_scope: [],
              tests: [],
            },
          },
        ]),
      ),
    });
    try {
      const runs = Object.values(second.store.state.runs);
      expect(runs.find((run) => run.agent === "implement")?.state).toBe("lost");
      while (
        second.store.state.tasks["K-1/t1"]?.stage === "building" &&
        !second.store.state.tasks["K-1/t1"]?.hold
      ) {
        await Bun.sleep(50);
      }
      const resumed = Object.values(second.store.state.runs)
        .filter((run) => run.agent === "implement")
        .at(-1);
      const first = second.store.db
        .query<{ node: string }, [string]>(
          "select json_extract(line, '$.node') as node from events where type = 'checkpoint' and run_id = ? order by id limit 1",
        )
        .get(resumed?.ref ?? "");
      expect(first?.node).toBe("implement");
    } finally {
      await second.scheduler.idle();
      await second.stop();
    }
  }, 120_000);
});
