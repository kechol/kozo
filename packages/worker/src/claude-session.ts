import type { HookInput, HookJSONOutput, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { sha256 } from "@kozo/core";
import {
  deniedCredentials,
  localSandbox,
  scrubbedShell,
  sessionEnvironmentFrom,
} from "@kozo/verify";
import type { AgentOutcome, AgentRequest, Instruction } from "./coding-agent.ts";

/** The built-in tools an agent may use; anything else is not offered at all. */
export const builtInTools = ["Read", "Glob", "Grep", "Edit", "Write", "Bash"];

/** The MCP server the request's own tools are offered under. */
export const toolServer = "kozo";

/** Every tool the session may call: the built-in ones and the request's own. */
export function allowedTools(request: AgentRequest): string[] {
  return [
    ...builtInTools,
    ...(request.tools ?? []).map((definition) => `mcp__${toolServer}__${definition.name}`),
  ];
}

/** The session's environment: what claude needs to run and to sign in, and the request's own. */
export function sessionEnvironment(request: AgentRequest): Record<string, string> {
  return { ...sessionEnvironmentFrom(process.env), ...request.env, ...scrubbedShell };
}

/** Claude Code's sandbox for the session's shell, which neither reads nor writes `hidden`. */
export function sessionSandbox(request: AgentRequest, hidden: string[] = []) {
  return localSandbox({
    denyRead: [...deniedCredentials(process.env), ...(request.sandbox?.denyRead ?? []), ...hidden],
    allowRead: request.sandbox?.allowRead ?? [],
    allowWrite: request.sandbox?.allowWrite ?? [],
    denyWrite: [...(request.sandbox?.denyWrite ?? []), ...hidden],
  });
}

function deliveredContext(instructions: Instruction[]) {
  return instructions
    .map((instruction) => `An instruction from the owner arrived: ${instruction.text}`)
    .join("\n");
}

/**
 * The session's hooks, each taking a hook's input and returning its output, whether Claude Code
 * calls them in the worker through the Agent SDK or as commands. The guard decides every tool
 * call, the calls are recorded, and queued instructions arrive after a tool, at the agent's
 * answer or at a stop.
 */
export function sessionHooks(request: AgentRequest) {
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

  /** Why the agent may not finish yet: instructions that arrived, or the stop-check's message. */
  const objection = async (): Promise<string | null> => {
    const instructions = await deliver();
    if (instructions.length > 0) return deliveredContext(instructions);
    return (await request.beforeStop?.()) ?? null;
  };

  const deny = (reason: string): HookJSONOutput => ({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  });

  const recordCall = (input: { tool_use_id: string; tool_name: string; tool_input: unknown }) =>
    request.record({
      type: "tool.call",
      data: { call_id: input.tool_use_id, tool: input.tool_name, input: input.tool_input },
    });

  return {
    async preToolUse(input: HookInput): Promise<HookJSONOutput> {
      if (input.hook_event_name !== "PreToolUse") return {};
      const decision = await request.guard(input.tool_name, input.tool_input);
      if (decision.allow) {
        // Claude Code ends a session at its structured answer whatever the Stop hook says, so
        // the answer itself is where the agent can still be sent back.
        const reason = input.tool_name === "StructuredOutput" ? await objection() : null;
        return reason === null ? {} : deny(reason);
      }
      recordCall(input);
      request.record({
        type: "guard.denied",
        data: { call_id: input.tool_use_id, tool: input.tool_name, reason: decision.reason },
      });
      return deny(decision.reason);
    },

    async afterTool(input: HookInput): Promise<HookJSONOutput> {
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
    },

    async stop(): Promise<HookJSONOutput> {
      const reason = await objection();
      return reason === null ? {} : { decision: "block", reason };
    },
  };
}

/**
 * Reads a session's messages: records what they report and gives the outcome at the result.
 * `spent` is what the session has used so far, for an outcome without a result.
 */
export function sessionReader(request: AgentRequest) {
  const spent = { costUsd: 0, turns: 0 };
  return {
    spent,
    read(message: SDKMessage): AgentOutcome | null {
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
        if (text) request.record({ type: "agent.message", data: { agent: request.agent, text } });
      }
      if (message.type !== "result") return null;
      spent.turns = message.num_turns;
      spent.costUsd = message.total_cost_usd;
      request.record({
        type: "cost.tick",
        data: {
          usd: spent.costUsd,
          in: message.usage.input_tokens,
          out: message.usage.output_tokens,
          cache_read: message.usage.cache_read_input_tokens,
        },
      });
      if (message.subtype === "success" && message.structured_output !== undefined) {
        return { status: "answered", output: message.structured_output, ...spent };
      }
      if (message.subtype === "success") {
        return {
          status: "failed",
          reason: `no structured answer: ${message.result.slice(0, 300)}`,
          ...spent,
        };
      }
      return { status: "failed", reason: message.subtype, ...spent };
    },
  };
}
