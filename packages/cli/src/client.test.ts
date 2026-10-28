import { afterEach, describe, expect, test } from "bun:test";
import { helloProof, kozoHome } from "@kozo/core";
import { tempDirectory } from "@kozo/testing";
import { connect, KozodUnavailable } from "./client.ts";

const saved = process.env.KOZO_PORT;
afterEach(() => {
  if (saved === undefined) delete process.env.KOZO_PORT;
  else process.env.KOZO_PORT = saved;
});

/** A home with a token and a server on a free port that answers with `fetch`. */
async function serverWith(fetch: (request: Request) => Response | Promise<Response>) {
  const dir = await tempDirectory();
  const home = kozoHome(dir.path);
  await Bun.write(home.apiToken, "token\n");
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch });
  process.env.KOZO_PORT = String(server.port);
  return {
    home,
    async [Symbol.asyncDispose]() {
      await server.stop(true);
      await dir[Symbol.asyncDispose]();
    },
  };
}

const hello = (request: Request) => {
  const nonce = new URL(request.url).searchParams.get("nonce") ?? "";
  return Response.json({ proof: helloProof("token", nonce) });
};

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

  test("a kozod that does not answer hello in time counts as down", async () => {
    await using env = await serverWith(() => new Promise<Response>(() => {}));
    const connecting = connect(env.home, 200);
    await expect(connecting).rejects.toBeInstanceOf(KozodUnavailable);
    await expect(connecting).rejects.toThrow("kozod did not answer within 0.2 seconds");
  });

  test("an answer that is not JSON is reported, not thrown as a parse error", async () => {
    await using env = await serverWith((request) =>
      new URL(request.url).pathname === "/api/hello"
        ? hello(request)
        : new Response("<html>Bad Gateway</html>", { status: 502 }),
    );
    const client = await connect(env.home);
    await expect(client.get("/api/status")).rejects.toThrow(
      "kozod answered 502 with something that is not JSON",
    );
  });
});
