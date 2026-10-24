import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { apiPort, itemLevel, type KozoHome, kozoHome } from "@kozo/core";
import dashboard from "@kozo/dashboard/index.html";
import { baseOf, type Confine, claudeJudge, claudeVerifier, platformConfine } from "@kozo/verify";
import { CommandError, type Commands, createApi, serveApi } from "./api.ts";
import { apiToken } from "./api-token.ts";
import { Automations } from "./automations.ts";
import { ControlPlane } from "./control-plane.ts";
import { type DefinitionInUse, refreshDefinition, startingDefinition } from "./definition.ts";
import { EgressProxy, hostAllowed } from "./egress.ts";
import { evalCaseOf } from "./eval.ts";
import { EventStore } from "./event-store.ts";
import { ghGitHub } from "./github.ts";
import { GitHubSync } from "./github-sync.ts";
import { readItemFile } from "./item-file.ts";
import { type Launcher, processLauncher } from "./launcher.ts";
import { Notifier, type Notify, osNotify } from "./notifier.ts";
import { pruneRecords } from "./prune.ts";
import { Reconciler } from "./reconcile.ts";
import { buildReport } from "./report.ts";
import { readCharter } from "./repository.ts";
import { Runner } from "./runner.ts";
import { Scheduler } from "./scheduler.ts";
import { evidenceFile, taskRecords } from "./task-records.ts";
import { taskBranch } from "./worktrees.ts";

export interface DaemonOptions {
  home?: KozoHome;
  port?: number;
  /** How agent sessions start; tests pass the fake agent in process. */
  launcher?: Launcher;
  /** How often the scheduler looks for work to start, in milliseconds. */
  tickMs?: number;
  /** How the diff's commands are confined; this machine's sandbox when unset. */
  confine?: Confine;
  /** How the human is notified; the OS's notifications when unset. */
  notify?: Notify;
}

// A compiled kozod runs alone; under bun the entry points are files beside this one.
const compiled = !process.execPath.endsWith("/bun");

/** The worker command: kozod's own executable in worker mode. */
export function kozodCommand(): string[] {
  return compiled ? [process.execPath] : [process.execPath, join(import.meta.dir, "main.ts")];
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

/**
 * `load` read again at most once a minute for each key; a key unasked for longer is dropped,
 * so that closed items and removed repositories do not stay.
 */
function minuteCache<T>(load: (key: string) => Promise<T>): (key: string) => Promise<T> {
  const entries = new Map<string, { at: number; value: Promise<T> }>();
  return (key) => {
    const now = Date.now();
    for (const [known, entry] of entries) if (now - entry.at >= 60_000) entries.delete(known);
    const cached = entries.get(key);
    if (cached) return cached.value;
    const value = load(key);
    entries.set(key, { at: now, value });
    return value;
  };
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
    private readonly notifier: Notifier,
    private readonly timer: ReturnType<typeof setInterval>,
    private readonly reconciling: () => Promise<void>,
    private readonly egress: EgressProxy,
  ) {}

  static async start({
    home = kozoHome(),
    port = Number(process.env.KOZO_PORT ?? apiPort),
    launcher = processLauncher(kozodCommand()),
    tickMs = 2000,
    confine,
    notify = osNotify(),
  }: DaemonOptions = {}): Promise<Daemon> {
    // Without a sandbox kozod would run the diff's code with the owner's access, so it stops here.
    const confined = confine ?? (await platformConfine());
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
    // prepare reaches other hosts only through this proxy, which reads the allowlist each time.
    const egress = EgressProxy.start(
      (host) => hostAllowed(host, definition.current.factory.prepare_hosts ?? []),
      report,
    );
    const runner = new Runner(home, store, {
      launcher,
      judge: claudeJudge(claude),
      verifier: claudeVerifier(claude),
      definition,
      confine: confined,
      egress: egress.port,
    });
    const control = new ControlPlane(home, store, definition, runner);
    const scheduler = new Scheduler(store, runner, definition, report);
    const github = new GitHubSync(home, store, definition, control, ghGitHub(), report);
    if (definition.current.factory.mode === "github")
      control.moveToIssue = (ref) => github.moveToIssue(ref);
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
      install: apiCall(async ({ repository }) => {
        if (definition.current.factory.mode !== "github")
          throw new CommandError(409, "in local mode, kozo admin install writes the files itself");
        return await github.install(repository);
      }, false),
      evalCase: async ({ run }) => {
        const { id, evalCase } = await evalCaseOf(home, store, run);
        const text = `# Eval case, format version 1 (D-046), drafted from ${run}: add the hidden tests and\n# checks the outcome needs, then commit it to the factory definition.\n${Bun.YAML.stringify(evalCase, null, 2)}\n`;
        return { message: `drafted evals/${id}.yml from ${run}`, id, text };
      },
      prune: apiCall(
        ({ older_than_days, dry_run }) =>
          pruneRecords(home, store, older_than_days, dry_run ?? false),
        false,
      ),
    };
    // For the dashboard's levels: each repository's Charter and each item's requested class.
    const charterOf = minuteCache((repository) =>
      readCharter(repository, definition.current.factory.mode, store.state),
    );
    const requestedClass = minuteCache((ref) => readItemFile(home, ref).then((file) => file.class));
    const app = createApi({
      store,
      token: await apiToken(home),
      port,
      mode: definition.current.factory.mode,
      commands,
      repositories: () => definition.current.factory.repositories.map(({ path }) => path),
      report: (view, days) =>
        buildReport(store.db, store.state, definition.current.factory, view, days),
      records: {
        task: (ref) => taskRecords(home, store, ref),
        evidence: (run, path) => evidenceFile(home, run, path),
      },
      async autonomy(ref) {
        const item = store.state.items[ref];
        if (!item) return { class: null, level: null };
        const requested = await requestedClass(ref);
        const drafted = item.plan?.class ?? item.draft?.class ?? null;
        const charter = await charterOf(item.repository);
        return {
          class: drafted ?? requested,
          level: charter.ok ? itemLevel(charter.charter, requested, drafted) : null,
        };
      },
      async locateTask(ref) {
        const repository = store.state.items[store.state.tasks[ref]?.item ?? ""]?.repository;
        if (!repository) return null;
        return {
          repository,
          branch: taskBranch(store.factoryId, ref),
          base: (await baseOf(repository, definition.current.factory.mode)).base,
        };
      },
    });
    const server = serveApi(app, port, dashboard);
    const reconciler = new Reconciler(
      store,
      runner,
      report,
      (ref, work) => scheduler.startWork(ref, work),
      () => definition.current.factory.mode,
    );
    await reconciler.recover();
    // In GitHub mode work arrives as Issues, so automations add items only in local mode.
    const automations = new Automations(
      control,
      () => (definition.current.factory.mode === "local" ? definition.current.automations : []),
      report,
    );
    const notifier = new Notifier(store, () => definition.current.factory, notify);
    notifier.start();
    void notifier.remind();
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
      if (every(3_600_000)) void notifier.remind();
      // An item an automation adds is started by the next tick.
      reconciling = reconciling.then(() => automations.run(new Date()));
      scheduler.tick();
    }, tickMs);
    scheduler.tick();
    return new Daemon(
      home,
      store,
      port,
      server,
      scheduler,
      runner,
      notifier,
      timer,
      () => reconciling,
      egress,
    );
  }

  /**
   * Stops the sessions and waits for the work running now to end, so that no worker outlives
   * kozod and every run ends where the next start resumes it.
   */
  async stop() {
    clearInterval(this.timer);
    this.notifier.stop();
    await this.server.stop(true);
    this.runner.stop();
    const stopped = this.scheduler.stop();
    await this.reconciling();
    await stopped;
    this.egress.stop();
    this.store.close();
    await rm(this.home.pidFile, { force: true });
  }
}
