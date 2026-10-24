import type { HookInput, HookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import type { UnixSocketListener } from "bun";

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

/**
 * The worker's end of the bridge: a Unix socket at `path` that answers one JSON line with one
 * JSON line per connection. The socket's directory must be one only the worker's user opens.
 */
export function listenBridge(path: string, handlers: BridgeHandlers): UnixSocketListener<string> {
  const answer = async (request: BridgeRequest): Promise<unknown> => {
    if (request.kind === "hook") return await handlers.hook(request.input);
    if (request.kind === "tools") return handlers.tools();
    return await handlers.call(request.name, request.arguments);
  };
  return Bun.listen<string>({
    unix: path,
    socket: {
      open(socket) {
        socket.data = "";
      },
      data(socket, bytes) {
        socket.data += new TextDecoder().decode(bytes);
        const end = socket.data.indexOf("\n");
        if (end === -1) return;
        const line = socket.data.slice(0, end);
        socket.data = "";
        (async (): Promise<BridgeReply> => {
          try {
            return { ok: true, value: await answer(JSON.parse(line) as BridgeRequest) };
          } catch (error) {
            return { ok: false, error: (error as Error).message };
          }
        })().then((reply) => {
          socket.write(`${JSON.stringify(reply)}\n`);
          socket.end();
        });
      },
    },
  });
}

/** Sends one request to the worker's bridge and returns its value. */
async function ask(path: string, request: BridgeRequest): Promise<unknown> {
  let received = "";
  const { promise, resolve, reject } = Promise.withResolvers<unknown>();
  const settle = () => {
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
        received += new TextDecoder().decode(bytes);
      },
      close: settle,
      error: settle,
    },
  });
  socket.write(`${JSON.stringify(request)}\n`);
  return await promise;
}

/**
 * `kozod --hook <socket>`: the command Claude Code runs for each hook of a CLI session. It
 * passes the hook's input to the worker and prints the worker's output. When the worker cannot
 * answer, a tool call is refused, since the guard did not decide it.
 */
export async function hookMain(
  path: string,
  input: string,
  out: (text: string) => void,
  err: (text: string) => void,
): Promise<number> {
  const hook = JSON.parse(input) as HookInput;
  try {
    out(JSON.stringify(await ask(path, { kind: "hook", input: hook })));
    return 0;
  } catch (error) {
    err(`kozod: the worker did not answer the hook: ${(error as Error).message}`);
    // Exit code 2 blocks the tool call; any other code lets Claude Code go on.
    return hook.hook_event_name === "PreToolUse" ? 2 : 1;
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
        return reply(message.id, { tools: await ask(path, { kind: "tools" }) });
      case "tools/call":
        try {
          const text = await ask(path, {
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
  const decoder = new TextDecoder();
  let buffer = "";
  const pending: Promise<void>[] = [];
  for await (const chunk of input) {
    buffer += decoder.decode(chunk, { stream: true });
    let end = buffer.indexOf("\n");
    while (end >= 0) {
      const line = buffer.slice(0, end).trim();
      buffer = buffer.slice(end + 1);
      if (line) pending.push(handle(line));
      end = buffer.indexOf("\n");
    }
  }
  await Promise.all(pending);
  return 0;
}
