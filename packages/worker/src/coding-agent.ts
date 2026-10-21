import type { AgentName, Event } from "@kozo/core";

type RecordType =
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
