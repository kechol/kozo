import { describe, expect, test } from "bun:test";
import { Outbox } from "@kozo/verify";
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
  test("tunnels for a prepare command to an allowed host and refuses the rest, reporting each host once", async () => {
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
      const access = proxy.issue();
      const token = new URL(access.url).password;
      const auth = `Proxy-Authorization: Basic ${btoa(`kozo:${token}`)}\r\n`;
      const connect = (target: string, headers = auth) =>
        `CONNECT ${target} HTTP/1.1\r\nHost: x\r\n${headers}\r\n`;
      // A command without kozod's token, such as a gate, gets nothing, and nothing is reported.
      const tokenless = connect(`127.0.0.1:${upstream.port}`, "");
      expect(await exchange(proxy.port, tokenless)).toStartWith("HTTP/1.1 403");
      const tokenlessGet = "GET http://127.0.0.1/ HTTP/1.1\r\n\r\n";
      expect(await exchange(proxy.port, tokenlessGet)).toStartWith("HTTP/1.1 403");
      expect(await exchange(proxy.port, "x".repeat(9000))).toStartWith("HTTP/1.1 403");
      expect(reported).toEqual([]);

      const tunnel = await exchange(proxy.port, connect(`127.0.0.1:${upstream.port}`), "hello");
      expect(tunnel).toStartWith("HTTP/1.1 200 Connection Established");
      expect(tunnel).toContain("echo:hello");

      const other = connect(`localhost:${upstream.port}`);
      expect(await exchange(proxy.port, other)).toStartWith("HTTP/1.1 403");
      expect(await exchange(proxy.port, other)).toStartWith("HTTP/1.1 403");
      expect(await exchange(proxy.port, connect("127.0.0.1:22"))).toStartWith("HTTP/1.1 403");
      const get = `GET http://127.0.0.1/ HTTP/1.1\r\n${auth}\r\n`;
      expect(await exchange(proxy.port, get)).toStartWith("HTTP/1.1 403");
      expect(reported.filter((line) => line.includes("localhost"))).toHaveLength(1);
      expect(reported.filter((line) => line.includes("a malformed request"))).toHaveLength(1);

      // A revoked token is no token.
      const before = reported.length;
      access.revoke();
      const revoked = connect(`127.0.0.1:${upstream.port}`);
      expect(await exchange(proxy.port, revoked)).toStartWith("HTTP/1.1 403");
      expect(reported).toHaveLength(before);
    } finally {
      proxy.stop();
      upstream.stop(true);
    }
  });

  test("refuses a header that is not base64 and closes a revoked token's open tunnels", async () => {
    const upstream = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      socket: { data() {} },
    });
    const proxy = EgressProxy.start(
      () => true,
      () => {},
      upstream.port,
    );
    try {
      const target = `CONNECT 127.0.0.1:${upstream.port} HTTP/1.1\r\nHost: x\r\n`;
      const garbled = `${target}Proxy-Authorization: Basic a===\r\n\r\n`;
      expect(await exchange(proxy.port, garbled)).toStartWith("HTTP/1.1 403");

      const access = proxy.issue();
      const token = new URL(access.url).password;
      let received = "";
      const { promise: closed, resolve } = Promise.withResolvers<void>();
      const { promise: opened, resolve: open } = Promise.withResolvers<void>();
      const socket = await Bun.connect({
        hostname: "127.0.0.1",
        port: proxy.port,
        socket: {
          data(_socket, bytes) {
            received += new TextDecoder().decode(bytes);
            if (received.includes("200 Connection Established")) open();
          },
          close: () => resolve(),
          error: () => resolve(),
        },
      });
      socket.write(`${target}Proxy-Authorization: Basic ${btoa(`kozo:${token}`)}\r\n\r\n`);
      await opened;
      access.revoke();
      expect(await Promise.race([closed.then(() => "closed"), Bun.sleep(1000)])).toBe("closed");
    } finally {
      proxy.stop();
      upstream.stop(true);
    }
  });

  test("passes on all an upstream sends before it closes, however slowly the client reads", async () => {
    const body = new Uint8Array(8 * 1024 * 1024).fill(97);
    const upstream = Bun.listen<Outbox>({
      hostname: "127.0.0.1",
      port: 0,
      socket: {
        open(socket) {
          socket.data = new Outbox(socket);
          socket.data.write(body);
          socket.data.end();
        },
        drain(socket) {
          socket.data.drain();
        },
      },
    });
    const proxy = EgressProxy.start(
      () => true,
      () => {},
      upstream.port,
    );
    try {
      const token = new URL(proxy.issue().url).password;
      let received = 0;
      const { promise: closed, resolve } = Promise.withResolvers<void>();
      const socket = await Bun.connect({
        hostname: "127.0.0.1",
        port: proxy.port,
        socket: {
          data(_socket, bytes) {
            received += bytes.length;
          },
          close: () => resolve(),
          error: () => resolve(),
        },
      });
      socket.write(
        `CONNECT 127.0.0.1:${upstream.port} HTTP/1.1\r\nProxy-Authorization: Basic ${btoa(`kozo:${token}`)}\r\n\r\n`,
      );
      await Promise.race([closed, Bun.sleep(10_000)]);
      const established = "HTTP/1.1 200 Connection Established\r\n\r\n".length;
      expect(received).toBe(established + body.length);
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
