import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";

export interface JudgeRequest {
  instructions: string;
  prompt: string;
  /** JSON Schema that the answer must satisfy. */
  schema: Record<string, unknown>;
  model: string;
  maxCostUsd: number;
}

export interface JudgeAnswer {
  output: unknown;
  model: string;
  costUsd: number;
}

/** A separate model session that reads only its prompt and returns a structured answer. */
export interface Judge {
  judge(request: JudgeRequest): Promise<JudgeAnswer>;
}

export class JudgeError extends Error {}

/**
 * A judge that runs the user's own `claude` through the Agent SDK. The session has no tools, loads
 * no settings, CLAUDE.md or MCP servers, keeps no transcript, starts in an empty directory and
 * gets no GitHub token, so content in the prompt can only influence the answer.
 */
export function claudeJudge(executable: string): Judge {
  return {
    async judge(request) {
      const cwd = await mkdtemp(join(tmpdir(), "kozo-judge-"));
      const { GH_TOKEN: _, GITHUB_TOKEN: __, ...env } = process.env;
      try {
        let answer: JudgeAnswer | undefined;
        for await (const message of query({
          prompt: request.prompt,
          options: {
            pathToClaudeCodeExecutable: executable,
            cwd,
            env,
            model: request.model,
            systemPrompt: request.instructions,
            tools: [],
            allowedTools: [],
            settingSources: [],
            mcpServers: {},
            strictMcpConfig: true,
            persistSession: false,
            maxTurns: 3,
            maxBudgetUsd: request.maxCostUsd,
            outputFormat: { type: "json_schema", schema: request.schema },
          },
        })) {
          if (message.type !== "result") continue;
          if (message.subtype !== "success") {
            throw new JudgeError(`the judge session ended with ${message.subtype}`);
          }
          answer = {
            output: message.structured_output,
            model: request.model,
            costUsd: message.total_cost_usd,
          };
        }
        if (!answer) throw new JudgeError("the judge session ended without a result");
        return answer;
      } catch (error) {
        // The SDK reports a failed session, such as a rejected option, as a plain Error.
        if (error instanceof JudgeError) throw error;
        throw new JudgeError(`the judge session failed: ${(error as Error).message}`);
      } finally {
        await rm(cwd, { recursive: true, force: true });
      }
    },
  };
}
