import { describe, expect, test } from "bun:test";
import { chmod } from "node:fs/promises";
import { join } from "node:path";
import { tempDirectory } from "@kozo/testing";
import { z } from "zod";
import { claudeCliAgent } from "./claude-cli-agent.ts";
import { hookMain, listenBridge, mcpMain } from "./cli-bridge.ts";
import type { AgentRecord, AgentRequest } from "./coding-agent.ts";

/**
 * A stand-in for `claude -p` that runs the PreToolUse hook from its settings for one Bash call,
 * then answers with what it was given: its arguments, its stdin and the hook's output.
 */
const fakeClaude = (bun: string) => `#!${bun}
const args = process.argv.slice(2);
const after = (flag) => args[args.indexOf(flag) + 1];
const settings = JSON.parse(await Bun.file(after("--settings")).text());
const hook = Bun.spawn(["sh", "-c", settings.hooks.PreToolUse[0].hooks[0].command], {
  stdin: new Blob([JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "curl example.com" }, tool_use_id: "t1" })]),
  stdout: "pipe",
});
const decision = JSON.parse(await new Response(hook.stdout).text());
const say = (message) => console.log(JSON.stringify(message));
say({ type: "system", subtype: "init", claude_code_version: "2.1.309", model: after("--model") });
say({
  type: "result",
  subtype: "success",
  num_turns: 1,
  total_cost_usd: 0.01,
  usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0 },
  structured_output: {
    decision,
    prompt: await Bun.stdin.text(),
    sandbox: settings.sandbox.filesystem,
    tokenInCommand: settings.hooks.PreToolUse[0].hooks[0].command.includes(
      (await Bun.file(after("--settings").replace(/settings\\.json$/, "token")).text()).trim(),
    ),
    mcp: JSON.parse(await Bun.file(after("--mcp-config")).text()),
    args,
  },
});
`;

/** A helper that runs only the worker's hook command, as `kozod --hook` does. */
const helperScript = `import { hookMain, readBridgeToken } from ${JSON.stringify(join(import.meta.dir, "cli-bridge.ts"))};
const [, , mode, socket] = process.argv;
if (mode !== "--hook") process.exit(64);
process.exitCode = await hookMain(socket, await readBridgeToken(socket), await Bun.stdin.text(), (text) => console.log(text), (text) => console.error(text));
`;

function request(cwd: string, records: AgentRecord[]): AgentRequest {
  return {
    agent: "implement",
    model: "claude-sonnet-5-5",
    cwd,
    instructions: "Implement.",
    prompt: "GOAL x",
    outputSchema: { type: "object" },
    maxTurns: 3,
    maxCostUsd: 1,
    pendingInstructions: async () => [],
    record: (record) => records.push(record),
    signal: new AbortController().signal,
    guard: async (tool) => ({ allow: false, reason: `no ${tool} here` }),
    sandbox: { denyRead: ["/x/.kozo"], allowRead: [], allowWrite: [], denyWrite: [] },
    tools: [
      { name: "kozo_note", description: "Note.", input: { text: z.string() }, run: async () => "" },
    ],
  };
}

describe("claudeCliAgent", () => {
  test("runs claude -p with the SDK's options and answers its hooks with the guard", async () => {
    await using temp = await tempDirectory();
    const dir = temp.path;
    await Bun.write(join(dir, "claude"), fakeClaude(process.execPath));
    await chmod(join(dir, "claude"), 0o755);
    await Bun.write(join(dir, "helper.ts"), helperScript);
    const records: AgentRecord[] = [];
    const helper = [process.execPath, join(dir, "helper.ts")];
    const outcome = await claudeCliAgent(join(dir, "claude"), helper).run(request(dir, records));
    expect(outcome).toMatchObject({ status: "answered", costUsd: 0.01, turns: 1 });
    const output = (outcome as { output: Record<string, unknown> }).output;
    expect(output.decision).toEqual({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: "no Bash here",
      },
    });
    expect(output.prompt).toBe("GOAL x");
    const args = output.args as string[];
    const sandbox = output.sandbox as { denyRead: string[]; denyWrite: string[] };
    expect(sandbox.denyRead).toContain("/x/.kozo");
    // The directory of the socket and the token's files is hidden from the shell.
    const settingsDir =
      args[args.indexOf("--settings") + 1]?.replace(/\/settings\.json$/, "") ?? "";
    expect(sandbox.denyRead).toContain(settingsDir);
    expect(sandbox.denyWrite).toContain(settingsDir);
    expect(output.tokenInCommand).toBe(false);
    expect(output.mcp).toMatchObject({
      mcpServers: { kozo: { type: "stdio", command: process.execPath } },
    });
    for (const flag of ["--strict-mcp-config", "--no-session-persistence", "--verbose"]) {
      expect(args).toContain(flag);
    }
    expect(args[args.indexOf("--setting-sources") + 1]).toBe("");
    expect(args[args.indexOf("--allowedTools") + 1]).toContain("mcp__kozo__kozo_note");
    expect(records.map((record) => record.type)).toEqual([
      "tool.call",
      "guard.denied",
      "session.started",
      "cost.tick",
    ]);
  });
});

describe("the CLI bridge", () => {
  test("serves the worker's tools over MCP and runs each call in the worker", async () => {
    await using dir = await tempDirectory();
    const socket = join(dir.path, "bridge.sock");
    const calls: unknown[] = [];
    const bridge = listenBridge(socket, "t0ken", {
      hook: async () => ({}),
      tools: () => [{ name: "kozo_note", description: "Note.", inputSchema: { type: "object" } }],
      call: async (name, input) => {
        calls.push(input);
        if (name !== "kozo_note") throw new Error(`no tool ${name}`);
        return "noted";
      },
    });
    try {
      const messages = [
        { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } },
        { jsonrpc: "2.0", method: "notifications/initialized" },
        { jsonrpc: "2.0", id: 2, method: "tools/list" },
        {
          jsonrpc: "2.0",
          id: 3,
          method: "tools/call",
          params: { name: "kozo_note", arguments: { text: "hi" } },
        },
        { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "other" } },
      ];
      const input = new Blob([
        `${messages.map((message) => JSON.stringify(message)).join("\n")}\nnot json\n`,
      ]).stream();
      const out: Record<string, unknown>[] = [];
      await mcpMain(socket, "t0ken", input, (line) => out.push(JSON.parse(line)));
      const byId = (id: unknown) => out.find((message) => message.id === id);
      expect(byId(1)).toMatchObject({ result: { capabilities: { tools: {} } } });
      expect(byId(2)).toMatchObject({ result: { tools: [{ name: "kozo_note" }] } });
      expect(byId(3)).toMatchObject({ result: { content: [{ type: "text", text: "noted" }] } });
      expect(byId(4)).toMatchObject({ result: { isError: true } });
      expect(byId(null)).toMatchObject({ error: { code: -32700 } });
      expect(out).toHaveLength(5);
      expect(calls).toEqual([{ text: "hi" }, {}]);

      // Without the token, the worker answers nothing and runs nothing.
      const forged: Record<string, unknown>[] = [];
      const call = JSON.stringify(messages[3]);
      await mcpMain(socket, "wrong", new Blob([`${call}\n`]).stream(), (line) =>
        forged.push(JSON.parse(line)),
      );
      expect(forged).toMatchObject([
        { result: { isError: true, content: [{ text: "not authorized" }] } },
      ]);
      expect(calls).toHaveLength(2);
    } finally {
      bridge.stop(true);
    }
  });

  test("carries a request and a reply larger than a socket takes at once, whole", async () => {
    await using dir = await tempDirectory();
    const socket = join(dir.path, "bridge.sock");
    const bridge = listenBridge(socket, "t0ken", {
      hook: async () => ({}),
      tools: () => [],
      call: async (_name, input) => `${input.text}${input.text}`,
    });
    try {
      // Split at any byte, a character that takes three bytes still comes through.
      const text = "在庫あり".repeat(200_000);
      const call = { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "x" } };
      const message = { ...call, params: { name: "x", arguments: { text } } };
      const out: { result: { content: { text: string }[] } }[] = [];
      await mcpMain(socket, "t0ken", new Blob([`${JSON.stringify(message)}\n`]).stream(), (line) =>
        out.push(JSON.parse(line)),
      );
      expect(out[0]?.result.content[0]?.text).toBe(`${text}${text}`);
    } finally {
      bridge.stop(true);
    }
  });

  test("a hook the worker cannot answer refuses the tool call and the stop, and lets the rest go on", async () => {
    await using dir = await tempDirectory();
    const socket = join(dir.path, "absent.sock");
    const exit = (input: string) =>
      hookMain(
        socket,
        "t0ken",
        input,
        () => {},
        () => {},
      );
    expect(await exit(JSON.stringify({ hook_event_name: "PreToolUse" }))).toBe(2);
    expect(await exit(JSON.stringify({ hook_event_name: "Stop" }))).toBe(2);
    expect(await exit("not json")).toBe(2);
    expect(await exit(JSON.stringify({ hook_event_name: "PostToolUse" }))).toBe(1);
  });
});
