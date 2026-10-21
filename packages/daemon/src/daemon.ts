import { mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { apiPort, type KozoHome, kozoHome } from "@kozo/core";
import { claudeJudge, claudeVerifier } from "@kozo/verify";
import { type Commands, createApi, serveApi } from "./api.ts";
import { apiToken } from "./api-token.ts";
import { ControlPlane } from "./control-plane.ts";
import { EventStore } from "./event-store.ts";
import { loadFactory } from "./factory-config.ts";
import { type Launcher, processLauncher } from "./launcher.ts";
import { Reconciler } from "./reconcile.ts";
import { defaultBranch } from "./repository.ts";
import { Runner } from "./runner.ts";
import { Scheduler } from "./scheduler.ts";
import { taskBranch } from "./worktrees.ts";

export interface DaemonOptions {
  home?: KozoHome;
  port?: number;
  /** How agent sessions start; tests pass the fake agent in process. */
  launcher?: Launcher;
  /** How often the scheduler looks for work to start, in milliseconds. */
  tickMs?: number;
}

// A compiled kozod runs alone; under bun the entry points are files beside this one.
const compiled = !process.execPath.endsWith("/bun");

/** The worker command: kozod's own executable in worker mode. */
function kozodCommand(): string[] {
  return compiled ? [process.execPath] : [process.execPath, join(import.meta.dir, "main.ts")];
}

/** The kozo CLI as the agent runs it in its sandbox, for `kozo gates`. */
function kozoCommand(): string {
  if (!compiled)
    return `${process.execPath} ${join(import.meta.dir, "..", "..", "cli", "src", "main.ts")}`;
  const sibling = join(dirname(process.execPath), "kozo");
  return Bun.file(sibling).size > 0 ? sibling : (Bun.which("kozo") ?? "kozo");
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Claims the home for this process, refusing when another live kozod holds it. */
async function claimHome(home: KozoHome) {
  const file = Bun.file(home.pidFile);
  if (await file.exists()) {
    const pid = Number((await file.text()).trim());
    if (Number.isInteger(pid) && pid !== process.pid && alive(pid)) {
      throw new Error(`kozod is already running as pid ${pid} for ${home.root}`);
    }
  }
  await Bun.write(home.pidFile, `${process.pid}\n`);
}

/** A running kozod: the record plane, the commands and the local API around them. */
export class Daemon {
  private constructor(
    readonly home: KozoHome,
    readonly store: EventStore,
    readonly port: number,
    private readonly server: ReturnType<typeof serveApi>,
    readonly scheduler: Scheduler,
    private readonly timer: ReturnType<typeof setInterval>,
  ) {}

  static async start({
    home = kozoHome(),
    port = Number(process.env.KOZO_PORT ?? apiPort),
    launcher = processLauncher(kozodCommand()),
    tickMs = 2000,
  }: DaemonOptions = {}): Promise<Daemon> {
    await mkdir(home.root, { recursive: true, mode: 0o700 });
    const factory = await loadFactory(home);
    await claimHome(home);
    const store = await EventStore.open(home);
    const claude = process.env.KOZO_CLAUDE ?? Bun.which("claude") ?? "claude";
    const runner = new Runner(home, store, {
      launcher,
      judge: claudeJudge(claude),
      verifier: claudeVerifier(claude),
      kozoCommand: kozoCommand(),
      model: factory.agent_defaults.model,
      runtime: factory.runtime,
    });
    const control = new ControlPlane(home, store, factory, runner);
    const scheduler = new Scheduler(store, runner, factory, (line) => console.error(line));
    // Each write is one API call; the work the scheduler starts after it is kozod's own.
    const apiCall =
      <A extends unknown[], R>(command: (...args: A) => Promise<R>, tick = true) =>
      async (...args: A) => {
        const result = await store.during(Bun.randomUUIDv7(), () => command(...args));
        if (tick) scheduler.tick();
        return result;
      };
    const commands: Commands = {
      addItem: apiCall((body) => control.addItem(body)),
      act: apiCall((ref, reference, verb, body) => control.act(ref, reference, verb, body)),
      pauseFactory: apiCall(() => control.pauseFactory(), false),
      resumeFactory: apiCall(() => control.resumeFactory()),
      rebuildIndex: async () => {
        await store.rebuildIndex();
        return { message: "rebuilt kozo.db from the event logs" };
      },
    };
    const app = createApi({
      store,
      token: await apiToken(home),
      port,
      mode: factory.mode,
      commands,
      async locateTask(ref) {
        const repository = store.state.items[store.state.tasks[ref]?.item ?? ""]?.repository;
        if (!repository) return null;
        return { repository, branch: taskBranch(ref), base: await defaultBranch(repository) };
      },
    });
    const server = serveApi(app, port);
    const reconciler = new Reconciler(
      store,
      runner,
      (line) => console.error(line),
      (ref, work) => scheduler.startWork(ref, work),
    );
    await reconciler.recover();
    let reconciling = Promise.resolve();
    let ticks = 0;
    const timer = setInterval(() => {
      ticks += 1;
      // Reconciliation runs once a minute; looking for work to start, every tick.
      if (ticks % Math.max(1, Math.round(60_000 / tickMs)) === 0) {
        reconciling = reconciling.then(() => reconciler.reconcile()).then(() => scheduler.tick());
      }
      scheduler.tick();
    }, tickMs);
    scheduler.tick();
    return new Daemon(home, store, port, server, scheduler, timer);
  }

  async stop() {
    clearInterval(this.timer);
    await this.server.stop(true);
    this.store.close();
    await rm(this.home.pidFile, { force: true });
  }
}
