import type { Socket, TCPSocketListener } from "bun";

/**
 * The hosts prepare reaches without a setting: the package registries and the downloads their
 * packages and tools point at.
 */
export const registryHosts = [
  "registry.npmjs.org",
  "registry.yarnpkg.com",
  "repo.yarnpkg.com",
  "pypi.org",
  "files.pythonhosted.org",
  "crates.io",
  "index.crates.io",
  "static.crates.io",
  "proxy.golang.org",
  "sum.golang.org",
  "github.com",
  "codeload.github.com",
  "objects.githubusercontent.com",
  "release-assets.githubusercontent.com",
  "cdn.playwright.dev",
  "playwright.download.prss.microsoft.com",
  "playwright.azureedge.net",
];

/** Whether `host` is on the allowlist: a name, or under a `*.` suffix of `extra`. */
export function hostAllowed(host: string, extra: readonly string[] = []): boolean {
  const name = host.toLowerCase();
  return [...registryHosts, ...extra].some((pattern) =>
    pattern.startsWith("*.") ? name.endsWith(pattern.slice(1)) : name === pattern,
  );
}

/** Writes to a socket in order, keeping what it could not take until it drains. */
class Outbox {
  private queue: Uint8Array[] = [];
  constructor(private readonly socket: Socket<unknown>) {}

  write(bytes: Uint8Array) {
    if (this.queue.length > 0) {
      this.queue.push(bytes);
      return;
    }
    const written = this.socket.write(bytes);
    if (written < bytes.length) this.queue.push(bytes.subarray(Math.max(written, 0)));
  }

  drain() {
    while (this.queue.length > 0) {
      const next = this.queue[0] as Uint8Array;
      const written = this.socket.write(next);
      if (written < next.length) {
        this.queue[0] = next.subarray(Math.max(written, 0));
        return;
      }
      this.queue.shift();
    }
  }
}

interface Client {
  head: Uint8Array;
  /** The client's bytes after its request, held until the tunnel opens. */
  early: Uint8Array[];
  out: Outbox;
  upstream: { out: Outbox; socket: Socket<unknown> } | null;
  opening: boolean;
}

const crlf2 = new TextEncoder().encode("\r\n\r\n");
const forbidden = new TextEncoder().encode(
  "HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
);
const established = new TextEncoder().encode("HTTP/1.1 200 Connection Established\r\n\r\n");
const badGateway = new TextEncoder().encode(
  "HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
);

function indexOf(bytes: Uint8Array, needle: Uint8Array): number {
  outer: for (let i = 0; i + needle.length <= bytes.length; i += 1) {
    for (let j = 0; j < needle.length; j += 1) if (bytes[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

/** The most refused hosts kozod keeps and reports, so a stream of requests cannot grow it. */
const refusedLimit = 100;
const hostname = /^[a-z0-9.-]{1,253}$/;

/**
 * kozod's egress proxy for prepare: on 127.0.0.1, it opens a CONNECT tunnel to port 443 of a
 * host `allowed` accepts, for a request that carries a token kozod issued for one prepare
 * command, and refuses anything else, reporting each refused host once.
 */
export class EgressProxy {
  private constructor(
    private readonly server: TCPSocketListener<Client>,
    readonly refused: Set<string>,
    private readonly tokens: Set<string>,
  ) {}

  /**
   * A token for one prepare command and the proxy URL that carries it, which the command's
   * tools send as Proxy-Authorization; other commands on this machine, such as the gates, have
   * none. The token stops working once `revoke` is called.
   */
  issue(): { url: string; revoke: () => void } {
    const token = Bun.randomUUIDv7().replaceAll("-", "");
    this.tokens.add(token);
    return {
      url: `http://kozo:${token}@127.0.0.1:${this.port}`,
      revoke: () => this.tokens.delete(token),
    };
  }

  get port(): number {
    return this.server.port;
  }

  /** `tunnelPort` is 443 but in tests, which tunnel to a local server. */
  static start(
    allowed: (host: string) => boolean,
    report: (line: string) => void,
    tunnelPort = 443,
  ) {
    const refused = new Set<string>();
    const tokens = new Set<string>();
    const refuse = (client: Socket<Client>, host: string) => {
      // Only a host name is kept and reported; anything else a request said is not repeated.
      const name = hostname.test(host) ? host : "a malformed request";
      if (!refused.has(name) && refused.size < refusedLimit) {
        refused.add(name);
        report(`kozod: prepare may not reach ${name}; add it to prepare_hosts in factory.yml`);
      }
      client.write(forbidden);
      client.end();
    };
    const authorized = (head: string) => {
      const header = head.match(/^proxy-authorization: *basic +([A-Za-z0-9+/=]+) *$/im)?.[1];
      if (!header) return false;
      const [, token] = atob(header).split(":");
      return token !== undefined && tokens.has(token);
    };
    const server = Bun.listen<Client>({
      hostname: "127.0.0.1",
      port: 0,
      socket: {
        open(client) {
          client.data = {
            head: new Uint8Array(0),
            early: [],
            out: new Outbox(client as Socket<unknown>),
            upstream: null,
            opening: false,
          };
        },
        data(client, chunk) {
          const state = client.data;
          if (state.upstream) return state.upstream.out.write(chunk);
          if (state.opening) return void state.early.push(chunk);
          const head = new Uint8Array(state.head.length + chunk.length);
          head.set(state.head);
          head.set(chunk, state.head.length);
          const end = indexOf(head, crlf2);
          if (end === -1) {
            // A request line that never ends is not one kozod reads.
            if (head.length > 8192) refuse(client, "an overlong request");
            else state.head = head;
            return;
          }
          const request = new TextDecoder().decode(head.subarray(0, end));
          const line = request.split("\r\n")[0] ?? "";
          const match = line.match(/^CONNECT ([A-Za-z0-9.-]+):(\d+) HTTP\/1\.[01]$/);
          const host = match?.[1]?.toLowerCase() ?? "";
          if (!match || match[2] !== String(tunnelPort)) return refuse(client, "");
          // Without a token kozod issued, the request is not prepare's, so nothing is reported.
          if (!authorized(request)) {
            client.write(forbidden);
            client.end();
            return;
          }
          if (!allowed(host)) return refuse(client, host);
          state.opening = true;
          const rest = head.subarray(end + crlf2.length);
          if (rest.length > 0) state.early.push(rest);
          Bun.connect<undefined>({
            hostname: host,
            port: tunnelPort,
            socket: {
              open(upstream) {
                const out = new Outbox(upstream as Socket<unknown>);
                state.upstream = { out, socket: upstream as Socket<unknown> };
                state.opening = false;
                state.out.write(established);
                for (const early of state.early) out.write(early);
                state.early = [];
              },
              data(_upstream, bytes) {
                state.out.write(bytes);
              },
              drain() {
                state.upstream?.out.drain();
              },
              close() {
                client.end();
              },
              error() {
                client.end();
              },
            },
          }).catch(() => {
            client.write(badGateway);
            client.end();
          });
        },
        drain(client) {
          client.data.out.drain();
        },
        close(client) {
          client.data.upstream?.socket.end();
        },
        error(client) {
          client.data.upstream?.socket.end();
        },
      },
    });
    return new EgressProxy(server, refused, tokens);
  }

  stop() {
    this.server.stop(true);
  }
}
