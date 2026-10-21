import { afterEach, describe, expect, test } from "bun:test";
import { kozoHome } from "@kozo/core";
import { tempDirectory } from "@kozo/testing";
import { connect } from "./client.ts";

const saved = process.env.KOZO_PORT;
afterEach(() => {
  process.env.KOZO_PORT = saved;
});

describe("connect", () => {
  test("never sends the token to a server that cannot prove it holds it", async () => {
    await using dir = await tempDirectory();
    const home = kozoHome(dir.path);
    await Bun.write(home.apiToken, `${"c".repeat(64)}\n`);
    const seen: (string | null)[] = [];
    const squatter = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        seen.push(request.headers.get("authorization"));
        return Response.json({ proof: "0".repeat(64) });
      },
    });
    process.env.KOZO_PORT = String(squatter.port);
    try {
      await expect(connect(home)).rejects.toThrow("is not this home's kozod");
      expect(seen).toEqual([null]);
    } finally {
      await squatter.stop(true);
    }
  });
});
