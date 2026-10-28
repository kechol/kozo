import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import type { HookInput } from "@anthropic-ai/claude-agent-sdk";
import { tempDirectory } from "@kozo/testing";
import { ask, type BridgeHandlers, listenBridge } from "./cli-bridge.ts";

async function bridgeWith(handlers: Partial<BridgeHandlers>) {
  const dir = await tempDirectory();
  const socket = join(dir.path, "bridge.sock");
  const calls: string[] = [];
  const bridge = listenBridge(socket, "t0ken", {
    hook: async () => ({}),
    tools: () => [],
    call: async (name) => {
      calls.push(name);
      return "";
    },
    ...handlers,
  });
  return {
    socket,
    calls,
    async [Symbol.asyncDispose]() {
      bridge.stop(true);
      await dir[Symbol.asyncDispose]();
    },
  };
}

describe("listenBridge and ask", () => {
  test("a hook's input reaches the worker and its output comes back", async () => {
    const seen: HookInput[] = [];
    await using env = await bridgeWith({
      hook: async (input) => {
        seen.push(input);
        return { continue: false, stopReason: "stop-check" };
      },
    });
    const input = { hook_event_name: "Stop" } as HookInput;
    expect(await ask(env.socket, "t0ken", { kind: "hook", input })).toEqual({
      continue: false,
      stopReason: "stop-check",
    });
    expect(seen).toEqual([input]);
  });

  test("a reply far larger than one socket write comes back whole", async () => {
    const text = "在庫あり".repeat(300_000);
    await using env = await bridgeWith({ call: async () => text });
    expect(await ask(env.socket, "t0ken", { kind: "call", name: "x", arguments: {} })).toBe(text);
  });

  test("a request without the token is refused and runs nothing", async () => {
    await using env = await bridgeWith({});
    const call = { kind: "call", name: "kozo_note", arguments: {} } as const;
    await expect(ask(env.socket, "wrong", call)).rejects.toThrow("not authorized");
    await expect(ask(env.socket, "", call)).rejects.toThrow("not authorized");
    expect(env.calls).toEqual([]);
  });

  test("a worker that throws answers with its error, and the bridge keeps serving", async () => {
    await using env = await bridgeWith({
      call: async (name) => {
        throw new Error(`no tool ${name}`);
      },
      tools: () => [{ name: "kozo_note", description: "Note.", inputSchema: {} }],
    });
    await expect(
      ask(env.socket, "t0ken", { kind: "call", name: "other", arguments: {} }),
    ).rejects.toThrow("no tool other");
    expect(await ask(env.socket, "t0ken", { kind: "tools" })).toEqual([
      { name: "kozo_note", description: "Note.", inputSchema: {} },
    ]);
  });

  test("a socket nobody listens on is reported as a worker that did not answer", async () => {
    await using dir = await tempDirectory();
    await expect(ask(join(dir.path, "absent.sock"), "t0ken", { kind: "tools" })).rejects.toThrow();
  });
});
