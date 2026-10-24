import { describe, expect, test } from "bun:test";
import { EgressProxy, hostAllowed } from "./egress.ts";

/** Sends `request` to the proxy, then `after` once it answers, and returns what came back. */
async function exchange(port: number, request: string, after = "") {
  let received = "";
  const { promise: closed, resolve } = Promise.withResolvers<void>();
  const socket = await Bun.connect({
    hostname: "127.0.0.1",
    port,
    socket: {
      data(socket, bytes) {
        received += new TextDecoder().decode(bytes);
        if (after && received.includes("200 Connection Established") && !received.includes(after)) {
          socket.write(after);
        }
      },
      close: () => resolve(),
      error: () => resolve(),
    },
  });
  socket.write(request);
  await Promise.race([closed, Bun.sleep(1000)]);
  socket.end();
  return received;
}

describe("EgressProxy", () => {
  test("tunnels to an allowed host and refuses the rest, reporting each host once", async () => {
    const upstream = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      socket: {
        data(socket, bytes) {
          socket.write(`echo:${new TextDecoder().decode(bytes)}`);
          socket.end();
        },
      },
    });
    const reported: string[] = [];
    const proxy = EgressProxy.start(
      (host) => host === "127.0.0.1",
      (line) => reported.push(line),
      upstream.port,
    );
    try {
      const tunnel = await exchange(
        proxy.port,
        `CONNECT 127.0.0.1:${upstream.port} HTTP/1.1\r\nHost: x\r\n\r\n`,
        "hello",
      );
      expect(tunnel).toStartWith("HTTP/1.1 200 Connection Established");
      expect(tunnel).toContain("echo:hello");

      const other = `CONNECT localhost:${upstream.port} HTTP/1.1\r\n\r\n`;
      expect(await exchange(proxy.port, other)).toStartWith("HTTP/1.1 403");
      expect(await exchange(proxy.port, other)).toStartWith("HTTP/1.1 403");
      expect(await exchange(proxy.port, "CONNECT 127.0.0.1:22 HTTP/1.1\r\n\r\n")).toStartWith(
        "HTTP/1.1 403",
      );
      expect(await exchange(proxy.port, "GET http://127.0.0.1/ HTTP/1.1\r\n\r\n")).toStartWith(
        "HTTP/1.1 403",
      );
      expect(reported.filter((line) => line.includes("localhost"))).toHaveLength(1);
    } finally {
      proxy.stop();
      upstream.stop(true);
    }
  });

  test("allows the registries and the hosts or suffixes the factory adds", () => {
    expect(hostAllowed("registry.npmjs.org")).toBe(true);
    expect(hostAllowed("Registry.NPMJS.org")).toBe(true);
    expect(hostAllowed("example.com")).toBe(false);
    expect(hostAllowed("npm.example.com", ["npm.example.com"])).toBe(true);
    expect(hostAllowed("a.mirror.example.com", ["*.mirror.example.com"])).toBe(true);
    expect(hostAllowed("mirror.example.com.evil.test", ["*.mirror.example.com"])).toBe(false);
  });
});
