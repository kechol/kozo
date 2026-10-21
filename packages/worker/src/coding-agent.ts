import type { AgentName, Event } from "@kozo/core";
import type { ZodType } from "zod";
import type { SandboxPaths } from "./task-sandbox.ts";

type RecordType =
  | "session.started"
  | "agent.message"
  | "tool.call"
  | "tool.result"
  | "instruction.delivered"
  | "cost.tick";

/** What an agent session reports while it runs; kozod wraps each one in an event envelope. */
export type AgentRecord = {
  [T in RecordType]: { type: T; data: Extract<Event, { type: T }>["data"] };
}[RecordType];

export interface Instruction {
  /** The instruction's line in the run's queue, counted from 0. */
  seq: number;
  text: string;
}

export type GuardDecision = { allow: true } | { allow: false; reason: string };

/** A tool that runs in the worker's own process, offered to the agent beside the built-in ones. */
export interface AgentTool {
  name: string;
  description: string;
  /** A zod object shape of the tool's input. */
  input: Record<string, ZodType>;
  run(input: Record<string, unknown>): Promise<string>;
}

export interface AgentRequest {
  agent: AgentName;
  model: string;
  /** The worktree, the only place the session may write. */
  cwd: string;
  /** The agent definition, given as the system prompt. */
  instructions: string;
  /** The rendered brief, given as the first message. */
  prompt: string;
  /** JSON Schema that the session's final answer must satisfy. */
  outputSchema: Record<string, unknown>;
  maxTurns: number;
  maxCostUsd: number;
  /** Instructions queued since the last call, delivered at the next turn boundary. */
  pendingInstructions(): Promise<Instruction[]>;
  record(record: AgentRecord): void;
  /** Aborted when kozod stops the run; the session ends as soon as it can. */
  signal: AbortSignal;
  /**
   * Decides each tool call before it runs; a refusal reaches the agent as its reason. It is
   * required because the file tools run outside the sandbox and only the guard confines them.
   */
  guard(tool: string, input: unknown): Promise<GuardDecision>;
  /** Asked when the agent tries to finish; a message sends it back to work with that message. */
  beforeStop?(): Promise<string | null>;
  tools?: AgentTool[];
  /** Variables added to the session's environment, such as the factory's git identity. */
  env?: Record<string, string>;
  /** Paths for the shell's sandbox beyond the credentials it never reads. */
  sandbox?: SandboxPaths;
}

export type AgentOutcome =
  | { status: "answered"; output: unknown; costUsd: number; turns: number }
  | { status: "failed"; reason: string; costUsd: number; turns: number }
  | { status: "stopped"; costUsd: number; turns: number };

/**
 * One way to run an agent session. Every implementation, the Agent SDK adapter and the fake
 * agent alike, passes the same contract tests.
 */
export interface CodingAgent {
  run(request: AgentRequest): Promise<AgentOutcome>;
}
