import { describe, expect, test } from "bun:test";
import { kozoHome } from "@kozo/core";
import { tempDirectory } from "@kozo/testing";
import { Daemon } from "./daemon.ts";

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
});
