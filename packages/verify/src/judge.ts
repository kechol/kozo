import { mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { type Options, query } from "@anthropic-ai/claude-agent-sdk";

export interface SessionRequest {
  instructions: string;
  prompt: string;
  /** JSON Schema that the answer must satisfy. */
  schema: Record<string, unknown>;
  model: string;
  maxCostUsd: number;
}

export interface SessionAnswer {
  output: unknown;
  model: string;
  costUsd: number;
}

/** A separate model session without tools that reads only its prompt; see the glossary. */
export interface Judge {
  judge(request: SessionRequest): Promise<SessionAnswer>;
}

/** A session that runs the app in `cwd` with shell access, confined by the sandbox. */
export interface Verifier {
  verify(request: SessionRequest & { cwd: string }): Promise<SessionAnswer>;
}

export class SessionError extends Error {}

// What claude needs to run and to sign in. Everything else, GitHub tokens and cloud credentials
// included, stays out of the session and of the shell it starts.
const sessionEnvironment = [
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "TMPDIR",
  "LANG",
  "LC_ALL",
  "TERM",
  "ANTHROPIC_API_KEY",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "CLAUDE_CONFIG_DIR",
];

/**
 * A judge that runs the user's own `claude` through the Agent SDK. The session has no tools and
 * starts in an empty directory, so content in the prompt can only influence the answer.
 */
export function claudeJudge(executable: string): Judge {
  return {
    async judge(request) {
      const cwd = await mkdtemp(join(tmpdir(), "kozo-judge-"));
      try {
        return await runSession(executable, request, { cwd, tools: [], maxTurns: 3 });
      } finally {
        await rm(cwd, { recursive: true, force: true });
      }
    },
  };
}

// Only the shell, because only the shell runs inside the sandbox below; Read, Glob and Grep run
// in Claude Code's own process and could read outside the worktree.
const verifyTools = ["Bash"];

// Credentials a verify session never needs; the sandbox denies reading them from the shell.
const credentialPaths = [
  ".ssh",
  ".aws",
  ".gnupg",
  ".config/gh",
  ".git-credentials",
  ".netrc",
  ".claude",
];

/**
 * A verifier that runs the user's own `claude` in the worktree with the shell as its only tool.
 * Shell commands run in Claude Code's sandbox: writes stay inside the worktree, the network
 * reaches only this machine, and the credential files above cannot be read. A sandbox that
 * cannot start fails the session.
 */
export function claudeVerifier(executable: string): Verifier {
  return {
    async verify({ cwd, ...request }) {
      return await runSession(executable, request, {
        cwd,
        tools: verifyTools,
        maxTurns: 80,
        permissionMode: "dontAsk",
        sandbox: {
          enabled: true,
          failIfUnavailable: true,
          autoAllowBashIfSandboxed: true,
          allowUnsandboxedCommands: false,
          network: {
            allowedDomains: ["localhost", "127.0.0.1"],
            strictAllowlist: true,
            allowLocalBinding: true,
          },
          filesystem: { denyRead: credentialPaths.map((path) => join(homedir(), path)) },
        },
      });
    },
  };
}

/**
 * Runs one session with no setting sources, CLAUDE.md, MCP servers or transcript, and returns
 * its structured output. The session gets only the environment it needs to run and to sign in.
 */
async function runSession(
  executable: string,
  request: SessionRequest,
  session: Pick<Options, "cwd" | "maxTurns" | "permissionMode" | "sandbox"> & { tools: string[] },
): Promise<SessionAnswer> {
  const env = Object.fromEntries(
    sessionEnvironment
      .filter((name) => process.env[name] !== undefined)
      .map((name) => [name, process.env[name]]),
  );
  try {
    let answer: SessionAnswer | undefined;
    for await (const message of query({
      prompt: request.prompt,
      options: {
        ...session,
        pathToClaudeCodeExecutable: executable,
        env,
        model: request.model,
        systemPrompt: request.instructions,
        allowedTools: session.tools,
        settingSources: [],
        mcpServers: {},
        strictMcpConfig: true,
        persistSession: false,
        maxBudgetUsd: request.maxCostUsd,
        outputFormat: { type: "json_schema", schema: request.schema },
      },
    })) {
      if (message.type !== "result") continue;
      if (message.subtype !== "success") {
        throw new SessionError(`the session ended with ${message.subtype}`);
      }
      answer = {
        output: message.structured_output,
        model: request.model,
        costUsd: message.total_cost_usd,
      };
    }
    if (!answer) throw new SessionError("the session ended without a result");
    return answer;
  } catch (error) {
    // The SDK reports a failed session, such as a rejected option, as a plain Error.
    if (error instanceof SessionError) throw error;
    throw new SessionError(`the session failed: ${(error as Error).message}`);
  }
}
