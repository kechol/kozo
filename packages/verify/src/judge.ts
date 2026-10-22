import { mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { type Options, query } from "@anthropic-ai/claude-agent-sdk";
import type { z } from "zod";
import { pickEnvironment } from "./command.ts";

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

/**
 * Escapes the closing tags of a prompt's sections inside text that fills one of them, so that
 * text from a request or a diff cannot end its section and pose as the next.
 */
export function defuseSections(text: string, sections: readonly string[]): string {
  return text.replace(new RegExp(`</(${sections.join("|")})`, "gi"), "<\\/$1");
}

/** The lines of a judge's instructions that give what the owner said since the plan. */
export function ownerNotesSection(
  notes: readonly string[],
  defuse: (text: string) => string,
): string[] {
  if (notes.length === 0) return [];
  return [
    "The owner has since said, which takes precedence where it differs:",
    ...notes.map((note) => `- ${defuse(note)}`),
  ];
}

/** Checks a session's output against the judgment schema it was asked to answer with. */
export function parseAnswer<T>(schema: z.ZodType<T>, name: string, output: unknown): T {
  const judgment = schema.safeParse(output);
  if (!judgment.success) {
    throw new SessionError(
      `the ${name} answer does not match its schema: ${judgment.error.message}`,
    );
  }
  return judgment.data;
}

// What claude needs to run and to sign in. Everything else, GitHub tokens and cloud credentials
// included, stays out of the session; a verify session's shell loses the sign-in variables too.
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

/** The variables of `source` that a session may see: what claude needs to run and to sign in. */
export const sessionEnvironmentFrom = (source: Record<string, string | undefined>) =>
  pickEnvironment(source, sessionEnvironment);

/**
 * Claude Code's sandbox for a session's shell: it must start, the shell runs nowhere else, the
 * network reaches only this machine, and the filesystem rules are the caller's.
 */
export function localSandbox(filesystem: {
  denyRead: string[];
  allowRead?: string[];
  allowWrite?: string[];
  denyWrite?: string[];
}) {
  return {
    enabled: true,
    failIfUnavailable: true,
    autoAllowBashIfSandboxed: true,
    allowUnsandboxedCommands: false,
    network: {
      allowedDomains: ["localhost", "127.0.0.1"],
      strictAllowlist: true,
      allowLocalBinding: true,
    },
    filesystem,
  };
}

/** Lets Claude Code remove its own sign-in variables from the environment of the shell. */
export const scrubbedShell = { CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: "1" };

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

// Credentials a session never needs; the sandbox denies reading them from the shell.
export const credentialPaths = [
  ".ssh",
  ".aws",
  ".gnupg",
  ".config/gh",
  ".config/gcloud",
  ".kube",
  ".docker",
  ".npmrc",
  ".pypirc",
  ".git-credentials",
  ".netrc",
  ".claude",
  "Library/Keychains",
];

/**
 * A verifier that runs the user's own `claude` in the worktree with the shell as its only tool.
 * Shell commands run in Claude Code's sandbox: writes stay inside the worktree, the network
 * reaches only this machine, and neither the credential files above nor the sign-in variables
 * can be read. A sandbox that cannot start fails the session.
 */
export function claudeVerifier(executable: string): Verifier {
  return {
    async verify({ cwd, ...request }) {
      return await runSession(executable, request, {
        cwd,
        tools: verifyTools,
        maxTurns: 80,
        permissionMode: "dontAsk",
        // The app under test, built from the diff, could otherwise read the sign-in variables.
        env: scrubbedShell,
        sandbox: localSandbox({ denyRead: credentialPaths.map((path) => join(homedir(), path)) }),
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
  {
    env: extra,
    ...session
  }: Pick<Options, "cwd" | "maxTurns" | "permissionMode" | "sandbox"> & {
    tools: string[];
    env?: Record<string, string>;
  },
): Promise<SessionAnswer> {
  const env = { ...sessionEnvironmentFrom(process.env), ...extra };
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
