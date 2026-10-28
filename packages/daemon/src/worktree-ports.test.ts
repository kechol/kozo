import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { tempDirectory } from "@kozo/testing";
import { takePorts, worktreeEnvironment } from "./worktree-ports.ts";

describe("takePorts", () => {
  test("takes distinct free ports once and keeps them for the worktree's life", async () => {
    await using dir = await tempDirectory();
    const worktree = join(dir.path, "shop-1a2b3c4d-K-12-t1");
    const ports = await takePorts(worktree, 3);
    expect(new Set(ports).size).toBe(3);
    expect(await takePorts(worktree, 3)).toEqual(ports);
    expect((await takePorts(worktree, 4)).slice(0, 3)).toEqual(ports);
    expect(await worktreeEnvironment(worktree)).toMatchObject({
      KOZO_TASK_ID: "shop-1a2b3c4d-k-12-t1",
      KOZO_PORT_1: String(ports[0]),
      KOZO_PORT_3: String(ports[2]),
    });
  });

  test("never hands one port to two worktrees, however many prepare at once", async () => {
    await using dir = await tempDirectory();
    const worktrees = Array.from({ length: 20 }, (_, index) =>
      join(dir.path, `shop-K-${index}-t1`),
    );
    const taken = await Promise.all(worktrees.map((worktree) => takePorts(worktree, 3)));
    const all = taken.flat();
    expect(all).toHaveLength(60);
    expect(new Set(all).size).toBe(60);
  });

  test("names a worktree without ports, in letters a container project accepts", async () => {
    await using dir = await tempDirectory();
    expect(await worktreeEnvironment(join(dir.path, "My Shop-1a2b3c4d-app#212-t2"))).toEqual({
      KOZO_TASK_ID: "my-shop-1a2b3c4d-app-212-t2",
    });
  });
});
