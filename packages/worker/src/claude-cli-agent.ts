import { randomBytes } from "node:crypto";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { lines, shellQuote } from "@kozo/verify";
import { z } from "zod";
import {
  allowedTools,
  builtInTools,
  sessionEnvironment,
  sessionHooks,
  sessionReader,
  sessionSandbox,
  toolServer,
} from "./claude-session.ts";
import { bridgeTokenPath, listenBridge } from "./cli-bridge.ts";
import type { CodingAgent } from "./coding-agent.ts";

/** How long a session has to end after SIGINT before it gets SIGTERM. */
const interruptGraceMs = 10_000;

/**
 * Runs an agent session as `claude -p` with the user's own `claude`, with the same options,
 * sandbox, hooks and tools as the Agent SDK adapter. The hooks and the MCP server are
 * `helper` (kozod's own executable) with `--hook` or `--mcp`, which pass each call to this
 * worker over a Unix socket, so the guard, the records and the tools run here.
 */
export function claudeCliAgent(executable: string, helper: readonly string[]): CodingAgent {
  return {
    async run(request) {
      const hooks = sessionHooks(request);
      const reader = sessionReader(request);
      const tools = request.tools ?? [];
      const dir = await mkdtemp(join(tmpdir(), "kozo-cli-"));
      const socket = join(dir, "bridge.sock");
      // Only the helpers get the token, from a file the session's shell may not read, so that a
      // shell which reaches the socket all the same can neither forge a record nor call a tool.
      const token = randomBytes(32).toString("hex");
      await writeFile(bridgeTokenPath(socket), token, { mode: 0o600 });
      const hidden = [...new Set([dir, await realpath(dir)])];
      const bridge = listenBridge(socket, token, {
        hook: (input) =>
          input.hook_event_name === "PreToolUse"
            ? hooks.preToolUse(input)
            : input.hook_event_name === "Stop"
              ? hooks.stop()
              : hooks.afterTool(input),
        tools: () =>
          tools.map((definition) => ({
            name: definition.name,
            description: definition.description,
            inputSchema: z.toJSONSchema(z.object(definition.input)) as Record<string, unknown>,
          })),
        call: async (name, input) => {
          const definition = tools.find((candidate) => candidate.name === name);
          if (!definition) throw new Error(`no tool ${name}`);
          return await definition.run(z.object(definition.input).parse(input));
        },
      });
      // A stop hook may run the gates, so no hook is cut short; kozod bounds the run itself.
      const hook = [
        {
          hooks: [
            {
              type: "command",
              command: [...helper, "--hook", socket].map(shellQuote).join(" "),
              timeout: 86_400,
            },
          ],
        },
      ];
      const settings = join(dir, "settings.json");
      const mcp = join(dir, "mcp.json");
      const systemPrompt = join(dir, "system-prompt.md");
      await Bun.write(
        settings,
        JSON.stringify({
          sandbox: sessionSandbox(request, hidden),
          hooks: { PreToolUse: hook, PostToolUse: hook, PostToolUseFailure: hook, Stop: hook },
        }),
      );
      await Bun.write(
        mcp,
        JSON.stringify({
          mcpServers:
            tools.length > 0
              ? {
                  [toolServer]: {
                    type: "stdio",
                    command: helper[0],
                    args: [...helper.slice(1), "--mcp", socket],
                  },
                }
              : {},
        }),
      );
      await Bun.write(systemPrompt, request.instructions);

      const child = Bun.spawn(
        [
          executable,
          "--print",
          "--output-format",
          "stream-json",
          "--verbose",
          "--model",
          request.model,
          "--system-prompt-file",
          systemPrompt,
          "--tools",
          builtInTools.join(","),
          "--allowedTools",
          allowedTools(request).join(","),
          "--permission-mode",
          "dontAsk",
          "--setting-sources",
          "",
          "--settings",
          settings,
          "--mcp-config",
          mcp,
          "--strict-mcp-config",
          "--no-session-persistence",
          "--max-turns",
          String(request.maxTurns),
          "--max-budget-usd",
          String(request.maxCostUsd),
          "--json-schema",
          JSON.stringify(request.outputSchema),
        ],
        {
          cwd: request.cwd,
          env: sessionEnvironment(request),
          stdin: new Blob([request.prompt]),
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      const stderr = new Response(child.stderr).text();
      let terminate: Timer | undefined;
      // SIGINT ends the session with a result that still reports its cost.
      const onAbort = () => {
        child.kill("SIGINT");
        terminate = setTimeout(() => child.kill("SIGTERM"), interruptGraceMs);
      };
      request.signal.addEventListener("abort", onAbort, { once: true });
      if (request.signal.aborted) onAbort();

      try {
        for await (const line of lines(child.stdout)) {
          if (!line.startsWith("{")) continue;
          const outcome = reader.read(JSON.parse(line) as SDKMessage);
          if (outcome && request.signal.aborted) return { status: "stopped", ...reader.spent };
          if (outcome) return outcome;
        }
        if (request.signal.aborted) return { status: "stopped", ...reader.spent };
        const code = await child.exited;
        const said = (await stderr).trim().slice(-300);
        return {
          status: "failed",
          kind: "crash",
          reason: `the session ended without a result (exit ${code})${said ? `: ${said}` : ""}`,
          ...reader.spent,
        };
      } finally {
        request.signal.removeEventListener("abort", onAbort);
        if (child.exitCode === null) child.kill("SIGTERM");
        await child.exited;
        clearTimeout(terminate);
        bridge.stop(true);
        await rm(dir, { recursive: true, force: true });
      }
    },
  };
}
