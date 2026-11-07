import { describe, expect, spyOn, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { kozoHome } from "@kozo/core";
import {
  eventually,
  fakeAgent,
  gitRepository,
  goodChange,
  reasonOf,
  suiteBase,
  suiteTask,
  tempDirectory,
  testConfine,
} from "@kozo/testing";
import { claimHome, Daemon, serialJobs } from "./daemon.ts";
import { inProcessLauncher } from "./launcher.ts";

const silent = async () => {};

describe("Daemon", () => {
  test("serves the local API on 127.0.0.1 with the home's token, and only once per home", async () => {
    await using dir = await tempDirectory();
    const home = kozoHome(dir.path);
    const daemon = await Daemon.start({ home, port: 0, confine: testConfine, notify: silent });
    try {
      expect(await Bun.file(home.pidFile).text()).toBe(`${process.pid}\n`);
      // Another kozod, as development runs one: through bun.
      const other = Bun.spawn([process.execPath, "-e", "setTimeout(() => {}, 30_000)"]);
      try {
        await Bun.write(home.pidFile, `${other.pid}\n`);
        await expect(
          Daemon.start({ home, port: 0, confine: testConfine, notify: silent }),
        ).rejects.toThrow(`already running as pid ${other.pid}`);
      } finally {
        other.kill();
      }
    } finally {
      await daemon.stop();
    }
    expect(await Bun.file(home.pidFile).exists()).toBe(false);
  });

  test("logs and tells a factory definition it refuses at start, and runs the last applied", async () => {
    await using dir = await tempDirectory();
    await using factory = await gitRepository();
    const home = { ...kozoHome(dir.path), factory: factory.path };
    const first = await factory.commit({ "factory.yml": "concurrency: 2\n" });
    await (await Daemon.start({ home, port: 0, confine: testConfine, notify: silent })).stop();
    await factory.commit({ "factory.yml": "concurrency: none\n" });
    const told: string[] = [];
    const logged = spyOn(console, "error").mockImplementation(() => {});
    const notify = async (_title: string, body: string) => {
      told.push(body);
    };
    const daemon = await Daemon.start({ home, port: 0, confine: testConfine, notify });
    try {
      expect(logged.mock.calls.map(([line]) => String(line))).toContainEqual(
        expect.stringContaining(`; running ${first.slice(0, 12)}: factory.yml`),
      );
      await eventually(() => told.length > 0, "the notification of the refusal");
      expect(told).toEqual([
        expect.stringContaining("kozod refused the factory definition: factory.yml"),
      ]);
    } finally {
      logged.mockRestore();
      await daemon.stop();
    }
  });

  test("answers status over HTTP", async () => {
    await using dir = await tempDirectory();
    const home = kozoHome(dir.path);
    const port = 17000 + Math.floor(Math.random() * 1000);
    const daemon = await Daemon.start({ home, port, confine: testConfine, notify: silent });
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
      expect(await rebuilt.json()).toMatchObject({
        message: "rebuilt kozo.db from the event logs",
        code: "api.rebuilt",
      });
    } finally {
      await daemon.stop();
    }
  });

  test("serves the dashboard without the token, confined to its own origin, and nothing else", async () => {
    await using dir = await tempDirectory();
    const home = kozoHome(dir.path);
    const port = 17000 + Math.floor(Math.random() * 1000);
    const daemon = await Daemon.start({ home, port, confine: testConfine, notify: silent });
    try {
      const page = await fetch(`http://127.0.0.1:${port}/`);
      expect(page.status).toBe(200);
      const html = await page.text();
      expect(html).toContain("Content-Security-Policy");
      expect(html).toContain("default-src 'self'");
      const script = /<script[^>]+src="([^"]+)"/.exec(html)?.[1] ?? "";
      const bundle = await fetch(`http://127.0.0.1:${port}${script}`);
      expect(bundle.status).toBe(200);
      expect(await bundle.text()).toContain("kozo dashboard");
      expect((await fetch(`http://127.0.0.1:${port}/api/status`)).status).toBe(401);
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
      confine: testConfine,
      notify: silent,
      launcher: inProcessLauncher(
        fakeAgent((request) =>
          request.agent === "triage" ? [{ answer: triage }] : [{ hang: true }],
        ),
        testConfine,
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
    await eventually(
      () => reasonOf(first.store.state.items["K-1"]?.hold) === "plan approval",
      "the plan approval",
    );
    await post("/api/refs/K-1/approve", {});
    await eventually(() => first.store.state.items["K-1"]?.stage === "building", "K-1 in Building");
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
    await eventually(
      () => first.store.state.tasks["K-1/t1"]?.checkpoint?.node === "implement",
      "the checkpoint at implement",
    );
    await first.stop();

    const second = await Daemon.start({
      home,
      port,
      tickMs: 50,
      confine: testConfine,
      notify: silent,
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
        testConfine,
      ),
    });
    try {
      const runs = Object.values(second.store.state.runs);
      expect(runs.find((run) => run.agent === "implement")?.state).toBe("stopped");
      await eventually(
        () =>
          second.store.state.tasks["K-1/t1"]?.stage !== "building" ||
          Boolean(second.store.state.tasks["K-1/t1"]?.hold),
        "the resumed run to move or hold K-1/t1",
      );
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

describe("claimHome", () => {
  test("takes over a pid file that names a live program other than kozod", async () => {
    await using dir = await tempDirectory();
    const home = kozoHome(dir.path);
    const sleeper = Bun.spawn(["sleep", "30"]);
    try {
      await Bun.write(home.pidFile, `${sleeper.pid}\n`);
      await claimHome(home);
      expect(await Bun.file(home.pidFile).text()).toBe(`${process.pid}\n`);
    } finally {
      sleeper.kill();
    }
  });

  test("lets only one of two starts at once claim the home", async () => {
    await using dir = await tempDirectory();
    const daemonPath = join(import.meta.dir, "daemon.ts");
    const script = `
      const { claimHome } = await import(${JSON.stringify(daemonPath)});
      const { kozoHome } = await import("@kozo/core");
      try {
        await claimHome(kozoHome(${JSON.stringify(dir.path)}));
        console.log("claimed");
        await Bun.sleep(2_000);
      } catch (error) {
        console.log(error.message.includes("already running") ? "refused" : error.message);
      }
    `;
    const starts = [0, 1].map(() =>
      Bun.spawn([process.execPath, "-e", script], { cwd: import.meta.dir, stdout: "pipe" }),
    );
    const answers = await Promise.all(
      starts.map(async (start) => (await new Response(start.stdout).text()).trim()),
    );
    expect(answers.sort()).toEqual(["claimed", "refused"]);
  });
});

describe("serialJobs", () => {
  test("runs every job in order, reporting a failed one and going on", async () => {
    const lines: string[] = [];
    const ran: string[] = [];
    const jobs = serialJobs((line) => lines.push(line));
    jobs.add("reading the factory definition", async () => {
      ran.push("definition");
      throw new Error("factory.yml does not parse");
    });
    jobs.add("polling GitHub", async () => {
      ran.push("poll");
    });
    await jobs.idle();
    expect(ran).toEqual(["definition", "poll"]);
    expect(lines).toEqual([
      "kozod: reading the factory definition failed: Error: factory.yml does not parse",
    ]);
  });

  test("queues a job once while it waits, and a job of another key all the same", async () => {
    const ran: string[] = [];
    const jobs = serialJobs(() => {});
    const { promise: held, resolve: release } = Promise.withResolvers<void>();
    jobs.add("fetching", () => held);
    for (let tick = 0; tick < 3; tick += 1) {
      jobs.add("polling GitHub", async () => {
        ran.push("poll");
      });
      jobs.add(
        "running automations",
        async () => {
          ran.push(`automations ${tick < 2 ? "03:00" : "03:01"}`);
        },
        tick < 2 ? "03:00" : "03:01",
      );
    }
    release();
    await jobs.idle();
    expect(ran).toEqual(["poll", "automations 03:00", "automations 03:01"]);
    jobs.add("polling GitHub", async () => {
      ran.push("poll");
    });
    await jobs.idle();
    expect(ran.filter((job) => job === "poll")).toHaveLength(2);
  });
});
