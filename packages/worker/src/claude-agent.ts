import {
  createSdkMcpServer,
  type HookCallback,
  type HookJSONOutput,
  query,
  tool,
} from "@anthropic-ai/claude-agent-sdk";
import { sha256 } from "@kozo/core";
import {
  deniedCredentials,
  localSandbox,
  scrubbedShell,
  sessionEnvironmentFrom,
} from "@kozo/verify";
import type { AgentOutcome, CodingAgent, Instruction } from "./coding-agent.ts";

/** The built-in tools an agent may use; anything else is not offered at all. */
export const builtInTools = ["Read", "Glob", "Grep", "Edit", "Write", "Bash"];

const toolServer = "kozo";

function deliveredContext(instructions: Instruction[]) {
  return instructions
    .map((instruction) => `An instruction from the owner arrived: ${instruction.text}`)
    .join("\n");
}

/**
 * Runs an agent session through the Agent SDK with the user's own `claude`. Bash runs in
 * Claude Code's sandbox with the network limited to this machine; the request's guard decides
 * every tool call first, since the file tools run outside that sandbox.
 */
export function claudeAgent(executable: string): CodingAgent {
  return {
    async run(request) {
      let turns = 0;
      let costUsd = 0;
      const deliver = async () => {
        const instructions = await request.pendingInstructions();
        for (const instruction of instructions) {
          request.record({
            type: "instruction.delivered",
            data: { queue_seq: instruction.seq, text: instruction.text },
          });
        }
        return instructions;
      };

      const recordCall = (input: { tool_use_id: string; tool_name: string; tool_input: unknown }) =>
        request.record({
          type: "tool.call",
          data: { call_id: input.tool_use_id, tool: input.tool_name, input: input.tool_input },
        });

      const preToolUse: HookCallback = async (input) => {
        if (input.hook_event_name !== "PreToolUse") return {};
        const decision = await request.guard(input.tool_name, input.tool_input);
        if (decision.allow) return {};
        recordCall(input);
        request.record({
          type: "guard.denied",
          data: { call_id: input.tool_use_id, tool: input.tool_name, reason: decision.reason },
        });
        return {
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "deny",
            permissionDecisionReason: decision.reason,
          },
        };
      };

      const afterTool: HookCallback = async (input): Promise<HookJSONOutput> => {
        if (input.hook_event_name === "PostToolUse") {
          recordCall(input);
          request.record({
            type: "tool.result",
            data: {
              call_id: input.tool_use_id,
              is_error: false,
              output: input.tool_response ?? null,
            },
          });
        } else if (input.hook_event_name === "PostToolUseFailure") {
          recordCall(input);
          request.record({
            type: "tool.result",
            data: { call_id: input.tool_use_id, is_error: true, output: input.error },
          });
        } else {
          return {};
        }
        const instructions = await deliver();
        if (instructions.length === 0) return {};
        return {
          hookSpecificOutput: {
            hookEventName: input.hook_event_name,
            additionalContext: deliveredContext(instructions),
          },
        };
      };

      const stop: HookCallback = async () => {
        const instructions = await deliver();
        if (instructions.length > 0) {
          return { decision: "block", reason: deliveredContext(instructions) };
        }
        const objection = (await request.beforeStop?.()) ?? null;
        return objection === null ? {} : { decision: "block", reason: objection };
      };

      const tools = (request.tools ?? []).map((definition) =>
        tool(definition.name, definition.description, definition.input, async (input) => ({
          content: [{ type: "text", text: await definition.run(input as Record<string, unknown>) }],
        })),
      );
      const allowed = [
        ...builtInTools,
        ...(request.tools ?? []).map((definition) => `mcp__${toolServer}__${definition.name}`),
      ];
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
            allowedTools: allowed,
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
            env: {
              ...sessionEnvironmentFrom(process.env),
              ...request.env,
              ...scrubbedShell,
            },
            sandbox: localSandbox({
              denyRead: [...deniedCredentials(process.env), ...(request.sandbox?.denyRead ?? [])],
              allowRead: request.sandbox?.allowRead ?? [],
              allowWrite: request.sandbox?.allowWrite ?? [],
              denyWrite: request.sandbox?.denyWrite ?? [],
            }),
            hooks: {
              PreToolUse: [{ hooks: [preToolUse] }],
              PostToolUse: [{ hooks: [afterTool] }],
              PostToolUseFailure: [{ hooks: [afterTool] }],
              Stop: [{ hooks: [stop] }],
            },
          },
        })) {
          if (message.type === "system" && message.subtype === "init") {
            request.record({
              type: "session.started",
              data: {
                claude_version: message.claude_code_version,
                model: message.model,
                brief_sha: sha256(request.prompt),
                instructions_sha: sha256(request.instructions),
              },
            });
          }
          if (message.type === "assistant" && message.parent_tool_use_id === null) {
            const text = message.message.content
              .flatMap((block) => (block.type === "text" ? [block.text] : []))
              .join("\n")
              .trim();
            if (text)
              request.record({ type: "agent.message", data: { agent: request.agent, text } });
          }
          if (message.type !== "result") continue;
          turns = message.num_turns;
          costUsd = message.total_cost_usd;
          request.record({
            type: "cost.tick",
            data: {
              usd: costUsd,
              in: message.usage.input_tokens,
              out: message.usage.output_tokens,
              cache_read: message.usage.cache_read_input_tokens,
            },
          });
          if (message.subtype === "success" && message.structured_output !== undefined) {
            return { status: "answered", output: message.structured_output, costUsd, turns };
          }
          if (message.subtype === "success") {
            return {
              status: "failed",
              reason: `no structured answer: ${message.result.slice(0, 300)}`,
              costUsd,
              turns,
            };
          }
          return { status: "failed", reason: message.subtype, costUsd, turns };
        }
        return { status: "failed", reason: "the session ended without a result", costUsd, turns };
      } catch (error) {
        if (request.signal.aborted)
          return { status: "stopped", costUsd, turns } satisfies AgentOutcome;
        return { status: "failed", reason: (error as Error).message, costUsd, turns };
      } finally {
        request.signal.removeEventListener("abort", onAbort);
      }
    },
  };
}
