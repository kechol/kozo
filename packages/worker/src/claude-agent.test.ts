import { describe, expect, mock, test } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";

let captured: Record<string, unknown> = {};
mock.module("@anthropic-ai/claude-agent-sdk", () => ({
  query: ({ options }: { options: Record<string, unknown> }) => {
    captured = options;
    return (async function* () {
      yield {
        type: "result",
        subtype: "success",
        num_turns: 1,
        total_cost_usd: 0.01,
        usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0 },
        structured_output: { word: "done" },
      };
    })();
  },
  createSdkMcpServer: (options: unknown) => options,
  tool: (...args: unknown[]) => args,
}));
const { claudeAgent } = await import("./claude-agent.ts");

describe("claudeAgent", () => {
  test("gives the session no credentials and a sandbox that denies gh and git credentials", async () => {
    const saved = { ...process.env };
    process.env.GH_TOKEN = "planted";
    process.env.GITHUB_TOKEN = "planted";
    process.env.AWS_SECRET_ACCESS_KEY = "planted";
    try {
      const outcome = await claudeAgent("/usr/local/bin/claude").run({
        agent: "implement",
        model: "claude-sonnet-5-5",
        cwd: "/tmp/worktree",
        instructions: "Implement.",
        prompt: "GOAL x",
        outputSchema: {},
        maxTurns: 3,
        maxCostUsd: 1,
        pendingInstructions: async () => [],
        record: () => {},
        signal: new AbortController().signal,
        env: { GIT_AUTHOR_NAME: "kozo" },
        guard: async () => ({ allow: true }),
        sandbox: {
          denyRead: ["/home/.kozo"],
          allowRead: ["/home/.kozo/worktrees/app-K-1-t1"],
          allowWrite: ["/src/app/.git/objects"],
          denyWrite: ["/home/.kozo/worktrees/app-K-1-t1/.git"],
        },
      });
      expect(outcome).toEqual({
        status: "answered",
        output: { word: "done" },
        costUsd: 0.01,
        turns: 1,
      });
    } finally {
      process.env = saved;
    }
    const env = captured.env as Record<string, string>;
    for (const name of ["GH_TOKEN", "GITHUB_TOKEN", "AWS_SECRET_ACCESS_KEY"]) {
      expect(env[name]).toBeUndefined();
    }
    expect(env).toMatchObject({ GIT_AUTHOR_NAME: "kozo", CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: "1" });
    const sandbox = captured.sandbox as {
      enabled: boolean;
      allowUnsandboxedCommands: boolean;
      failIfUnavailable: boolean;
      network: { allowedDomains: string[]; strictAllowlist: boolean };
      filesystem: {
        denyRead: string[];
        allowRead: string[];
        allowWrite: string[];
        denyWrite: string[];
      };
    };
    expect(sandbox).toMatchObject({
      enabled: true,
      allowUnsandboxedCommands: false,
      failIfUnavailable: true,
    });
    expect(sandbox.network).toMatchObject({
      allowedDomains: ["localhost", "127.0.0.1"],
      strictAllowlist: true,
    });
    for (const path of [".config/gh", ".git-credentials", ".config/git/credentials", ".ssh"]) {
      expect(sandbox.filesystem.denyRead).toContain(join(homedir(), path));
    }
    expect(sandbox.filesystem).toMatchObject({
      allowRead: ["/home/.kozo/worktrees/app-K-1-t1"],
      allowWrite: ["/src/app/.git/objects"],
      denyWrite: ["/home/.kozo/worktrees/app-K-1-t1/.git"],
    });
    expect(sandbox.filesystem.denyRead).toContain("/home/.kozo");
    expect(captured).toMatchObject({
      permissionMode: "dontAsk",
      settingSources: [],
      strictMcpConfig: true,
      tools: ["Read", "Glob", "Grep", "Edit", "Write", "Bash"],
    });
  });
});
