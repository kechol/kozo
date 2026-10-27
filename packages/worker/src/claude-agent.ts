import { createSdkMcpServer, query, tool } from "@anthropic-ai/claude-agent-sdk";
import {
  allowedTools,
  builtInTools,
  sessionEnvironment,
  sessionHooks,
  sessionReader,
  sessionSandbox,
  toolServer,
} from "./claude-session.ts";
import type { AgentOutcome, CodingAgent } from "./coding-agent.ts";

/**
 * Runs an agent session through the Agent SDK with the user's own `claude`. Bash runs in
 * Claude Code's sandbox with the network limited to this machine; the request's guard decides
 * every tool call first, since the file tools run outside that sandbox.
 */
export function claudeAgent(executable: string): CodingAgent {
  return {
    async run(request) {
      const hooks = sessionHooks(request);
      const reader = sessionReader(request);
      const tools = (request.tools ?? []).map((definition) =>
        tool(definition.name, definition.description, definition.input, async (input) => ({
          content: [{ type: "text", text: await definition.run(input as Record<string, unknown>) }],
        })),
      );
      const abort = new AbortController();
      const onAbort = () => abort.abort();
      request.signal.addEventListener("abort", onAbort, { once: true });
      if (request.signal.aborted) abort.abort();

      try {
        for await (const message of query({
          prompt: request.prompt,
          options: {
            abortController: abort,
            cwd: request.cwd,
            pathToClaudeCodeExecutable: executable,
            model: request.model,
            systemPrompt: request.instructions,
            tools: builtInTools,
            allowedTools: allowedTools(request),
            permissionMode: "dontAsk",
            settingSources: [],
            mcpServers:
              tools.length > 0
                ? { [toolServer]: createSdkMcpServer({ name: toolServer, tools }) }
                : {},
            strictMcpConfig: true,
            persistSession: false,
            maxTurns: request.maxTurns,
            maxBudgetUsd: request.maxCostUsd,
            outputFormat: { type: "json_schema", schema: request.outputSchema },
            env: sessionEnvironment(request),
            sandbox: sessionSandbox(request),
            hooks: {
              PreToolUse: [{ hooks: [hooks.preToolUse] }],
              PostToolUse: [{ hooks: [hooks.afterTool] }],
              PostToolUseFailure: [{ hooks: [hooks.afterTool] }],
              Stop: [{ hooks: [hooks.stop] }],
            },
          },
        })) {
          const outcome = reader.read(message);
          if (outcome) return outcome;
        }
        return {
          status: "failed",
          kind: "crash",
          reason: "the session ended without a result",
          ...reader.spent,
        };
      } catch (error) {
        if (request.signal.aborted)
          return { status: "stopped", ...reader.spent } satisfies AgentOutcome;
        // The SDK throws when Claude Code cannot reach or use the API, as for an outage.
        return { status: "failed", kind: "api", reason: (error as Error).message, ...reader.spent };
      } finally {
        request.signal.removeEventListener("abort", onAbort);
      }
    },
  };
}
