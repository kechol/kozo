import { dirname, join } from "node:path";
import type { HookInput, HookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { secretMatches } from "@kozo/core";
import { lines, Outbox } from "@kozo/verify";
import type { UnixSocketListener } from "bun";

/**
 * The file beside the socket that holds the bridge's token. The helpers read it there, so the
 * token is in no command line or environment that another process could see.
 */
export const bridgeTokenPath = (socket: string) => join(dirname(socket), "token");

/** The token for the bridge at `socket`, or "" when there is none, which the worker refuses. */
export async function readBridgeToken(socket: string): Promise<string> {
  try {
    return (await Bun.file(bridgeTokenPath(socket)).text()).trim();
  } catch {
    return "";
  }
}

/** One request a hook command or the MCP server sends to the worker. */
export type BridgeRequest =
  | { kind: "hook"; input: HookInput }
  | { kind: "tools" }
  | { kind: "call"; name: string; arguments: Record<string, unknown> };

export interface BridgeTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface BridgeHandlers {
  hook(input: HookInput): Promise<HookJSONOutput>;
  tools(): BridgeTool[];
  call(name: string, input: Record<string, unknown>): Promise<string>;
}

type BridgeReply = { ok: true; value: unknown } | { ok: false; error: string };

interface Connection {
  decoder: TextDecoder;
  received: string;
  out: Outbox;
}

const encoder = new TextEncoder();

/**
 * The worker's end of the bridge: a Unix socket at `path` that answers one JSON line with one
 * JSON line per connection, and only a request that carries `token`. The socket's directory
 * must be one the session's shell may neither read nor write.
 */
export function listenBridge(
  path: string,
  token: string,
  handlers: BridgeHandlers,
): UnixSocketListener<Connection> {
  const answer = async (request: BridgeRequest): Promise<unknown> => {
    if (request.kind === "hook") return await handlers.hook(request.input);
    if (request.kind === "tools") return handlers.tools();
    return await handlers.call(request.name, request.arguments);
  };
  return Bun.listen<Connection>({
    unix: path,
    socket: {
      open(socket) {
        socket.data = { decoder: new TextDecoder(), received: "", out: new Outbox(socket) };
      },
      data(socket, bytes) {
        const connection = socket.data;
        connection.received += connection.decoder.decode(bytes, { stream: true });
        const end = connection.received.indexOf("\n");
        if (end === -1) return;
        const line = connection.received.slice(0, end);
        connection.received = "";
        (async (): Promise<BridgeReply> => {
          try {
            const message = JSON.parse(line) as { token?: unknown; request: BridgeRequest };
            if (typeof message.token !== "string" || !secretMatches(message.token, token))
              return { ok: false, error: "not authorized" };
            return { ok: true, value: await answer(message.request) };
          } catch (error) {
            return { ok: false, error: (error as Error).message };
          }
        })().then((reply) => {
          connection.out.write(encoder.encode(`${JSON.stringify(reply)}\n`));
          connection.out.end();
        });
      },
      drain(socket) {
        socket.data.out.drain();
      },
    },
  });
}

/** Sends one request to the worker's bridge and returns its value. */
export async function ask(path: string, token: string, request: BridgeRequest): Promise<unknown> {
  const decoder = new TextDecoder();
  let received = "";
  let out: Outbox | null = null;
  const { promise, resolve, reject } = Promise.withResolvers<unknown>();
  const settle = () => {
    received += decoder.decode();
    try {
      const reply = JSON.parse(received) as BridgeReply;
      if (reply.ok) resolve(reply.value);
      else reject(new Error(reply.error));
    } catch {
      reject(new Error("the worker did not answer"));
    }
  };
  const socket = await Bun.connect({
    unix: path,
    socket: {
      data(_socket, bytes) {
        received += decoder.decode(bytes, { stream: true });
      },
      drain() {
        out?.drain();
      },
      close: settle,
      error: settle,
    },
  });
  out = new Outbox(socket);
  out.write(encoder.encode(`${JSON.stringify({ token, request })}\n`));
  return await promise;
}

/**
 * `kozod --hook <socket>`: the command Claude Code runs for each hook of a CLI session. It
 * passes the hook's input to the worker and prints the worker's output. When the worker cannot
 * answer, a tool call is refused and the agent may not stop, since neither the guard nor the
 * stop-check decided it.
 */
export async function hookMain(
  path: string,
  token: string,
  input: string,
  out: (text: string) => void,
  err: (text: string) => void,
): Promise<number> {
  let event: string | null = null;
  try {
    const hook = JSON.parse(input) as HookInput;
    event = hook.hook_event_name;
    out(JSON.stringify(await ask(path, token, { kind: "hook", input: hook })));
    return 0;
  } catch (error) {
    err(`kozod: the worker did not answer the hook: ${(error as Error).message}`);
    // Exit code 2 blocks the tool call or the stop; any other code lets Claude Code go on.
    return event === null || event === "PreToolUse" || event === "Stop" ? 2 : 1;
  }
}

interface RpcMessage {
  jsonrpc: "2.0";
  id?: number | string;
  method?: string;
  params?: Record<string, unknown>;
}

/**
 * `kozod --mcp <socket>`: the stdio MCP server of a CLI session, which offers the worker's tools
 * and runs each call in the worker.
 */
export async function mcpMain(
  path: string,
  token: string,
  input: AsyncIterable<Uint8Array>,
  out: (line: string) => void,
): Promise<number> {
  const reply = (id: RpcMessage["id"], result: unknown) =>
    out(JSON.stringify({ jsonrpc: "2.0", id, result }));
  const fail = (id: RpcMessage["id"] | null, code: number, message: string) =>
    out(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }));
  const answer = async (message: RpcMessage) => {
    switch (message.method) {
      case "initialize":
        return reply(message.id, {
          protocolVersion: message.params?.protocolVersion ?? "2025-06-18",
          capabilities: { tools: {} },
          serverInfo: { name: "kozo", version: "1" },
        });
      case "ping":
        return reply(message.id, {});
      case "tools/list":
        return reply(message.id, { tools: await ask(path, token, { kind: "tools" }) });
      case "tools/call":
        try {
          const text = await ask(path, token, {
            kind: "call",
            name: String(message.params?.name),
            arguments: (message.params?.arguments ?? {}) as Record<string, unknown>,
          });
          return reply(message.id, { content: [{ type: "text", text }] });
        } catch (error) {
          return reply(message.id, {
            content: [{ type: "text", text: (error as Error).message }],
            isError: true,
          });
        }
      default:
        return fail(message.id, -32601, `unknown method ${message.method}`);
    }
  };
  const handle = async (line: string) => {
    let message: RpcMessage;
    try {
      message = JSON.parse(line) as RpcMessage;
    } catch {
      return fail(null, -32700, "the message is not JSON");
    }
    if (message.id === undefined) return;
    try {
      await answer(message);
    } catch (error) {
      fail(message.id, -32603, (error as Error).message);
    }
  };
  const pending: Promise<void>[] = [];
  for await (const line of lines(input)) pending.push(handle(line));
  await Promise.all(pending);
  return 0;
}
