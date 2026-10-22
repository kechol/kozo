import { mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { apiPort, type KozoHome, kozoHome } from "@kozo/core";
import { claudeJudge, claudeVerifier, defaultBranch, shellQuote } from "@kozo/verify";
import { type Commands, createApi, serveApi } from "./api.ts";
import { apiToken } from "./api-token.ts";
import { ControlPlane } from "./control-plane.ts";
import { type DefinitionInUse, refreshDefinition, startingDefinition } from "./definition.ts";
import { EventStore } from "./event-store.ts";
import { ghGitHub } from "./github.ts";
import { GitHubSync } from "./github-sync.ts";
import { type Launcher, processLauncher } from "./launcher.ts";
import { Reconciler } from "./reconcile.ts";
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

/** The kozo CLI as the agent runs it in its sandbox, for `kozo gates`, quoted for `sh`. */
function kozoCommand(): string {
  if (!compiled)
    return [process.execPath, join(import.meta.dir, "..", "..", "cli", "src", "main.ts")]
      .map(shellQuote)
      .join(" ");
  const sibling = join(dirname(process.execPath), "kozo");
  return shellQuote(Bun.file(sibling).size > 0 ? sibling : (Bun.which("kozo") ?? "kozo"));
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
    private readonly runner: Runner,
    private readonly timer: ReturnType<typeof setInterval>,
    private readonly reconciling: () => Promise<void>,
  ) {}

  static async start({
    home = kozoHome(),
    port = Number(process.env.KOZO_PORT ?? apiPort),
    launcher = processLauncher(kozodCommand()),
    tickMs = 2000,
  }: DaemonOptions = {}): Promise<Daemon> {
    await mkdir(home.root, { recursive: true, mode: 0o700 });
    await claimHome(home);
    const store = await EventStore.open(home);
    const report = (line: string) => console.error(line);
    let definition: DefinitionInUse;
    try {
      definition = { current: await startingDefinition(home, store) };
    } catch (error) {
      store.close();
      await rm(home.pidFile, { force: true });
      throw error;
    }
    const claude = process.env.KOZO_CLAUDE ?? Bun.which("claude") ?? "claude";
    const runner = new Runner(home, store, {
      launcher,
      judge: claudeJudge(claude),
      verifier: claudeVerifier(claude),
      kozoCommand: kozoCommand(),
      definition,
    });
    const control = new ControlPlane(home, store, definition, runner);
    const scheduler = new Scheduler(store, runner, definition, report);
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
      mode: definition.current.factory.mode,
      commands,
      async locateTask(ref) {
        const repository = store.state.items[store.state.tasks[ref]?.item ?? ""]?.repository;
        if (!repository) return null;
        return {
          repository,
          branch: taskBranch(store.factoryId, ref),
          base: await defaultBranch(repository),
        };
      },
    });
    const server = serveApi(app, port);
    const reconciler = new Reconciler(store, runner, report, (ref, work) =>
      scheduler.startWork(ref, work),
    );
    await reconciler.recover();
    const github = new GitHubSync(store, definition, control, ghGitHub(), report);
    const pollGitHub = () =>
      definition.current.factory.mode === "github"
        ? github.poll().catch((error: unknown) => report(`kozod: polling GitHub failed: ${error}`))
        : Promise.resolve();
    let reconciling = pollGitHub().then(() => scheduler.tick());
    let ticks = 0;
    const every = (ms: number) => ticks % Math.max(1, Math.round(ms / tickMs)) === 0;
    const timer = setInterval(() => {
      ticks += 1;
      // GitHub is read every five minutes, with no webhook and no open port.
      if (every(300_000)) reconciling = reconciling.then(pollGitHub).then(() => scheduler.tick());
      // The factory definition is read and reconciliation runs once a minute; looking for work
      // to start, every tick.
      if (every(60_000)) {
        reconciling = reconciling
          .then(() => refreshDefinition(home, store, definition, report))
          .catch((error: unknown) =>
            report(`kozod: reading the factory definition failed: ${error}`),
          )
          .then(() => reconciler.reconcile())
          .then(() => scheduler.tick());
      }
      scheduler.tick();
    }, tickMs);
    scheduler.tick();
    return new Daemon(home, store, port, server, scheduler, runner, timer, () => reconciling);
  }

  /**
   * Stops the sessions and waits for the work running now to end, so that no worker outlives
   * kozod and every run ends where the next start resumes it.
   */
  async stop() {
    clearInterval(this.timer);
    await this.server.stop(true);
    this.runner.stop();
    const stopped = this.scheduler.stop();
    await this.reconciling();
    await stopped;
    this.store.close();
    await rm(this.home.pidFile, { force: true });
  }
}
