import { mkdir, rm } from "node:fs/promises";
import { apiPort } from "@kozo/core";
import { CommandError, type Commands, createApi, serveApi } from "./api.ts";
import { apiToken } from "./api-token.ts";
import { ControlPlane } from "./control-plane.ts";
import { EventStore } from "./event-store.ts";
import { loadFactory } from "./factory-config.ts";
import { type KozoHome, kozoHome } from "./home.ts";

export interface DaemonOptions {
  home?: KozoHome;
  port?: number;
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

const notYet = (what: string) => async (): Promise<never> => {
  throw new CommandError(501, `${what} is not available yet`);
};

/** A running kozod: the record plane, the commands and the local API around them. */
export class Daemon {
  private constructor(
    readonly home: KozoHome,
    readonly store: EventStore,
    readonly port: number,
    private readonly server: ReturnType<typeof serveApi>,
  ) {}

  static async start({
    home = kozoHome(),
    port = Number(process.env.KOZO_PORT ?? apiPort),
  }: DaemonOptions = {}): Promise<Daemon> {
    await mkdir(home.root, { recursive: true, mode: 0o700 });
    const factory = await loadFactory(home);
    await claimHome(home);
    const store = await EventStore.open(home);
    const control = new ControlPlane(home, store, factory);
    const commands: Commands = {
      addItem: (body) => control.addItem(body),
      act: notYet("this verb"),
      pauseFactory: notYet("pausing the factory"),
      resumeFactory: notYet("resuming the factory"),
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
    });
    return new Daemon(home, store, port, serveApi(app, port));
  }

  async stop() {
    await this.server.stop(true);
    this.store.close();
    await rm(this.home.pidFile, { force: true });
  }
}
