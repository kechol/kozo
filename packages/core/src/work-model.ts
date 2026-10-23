import { z } from "zod";

// Values are lowercase because GitHub mode shows a stage as the label `kozo:<stage>`.
export const stageSchema = z.enum([
  "intake",
  "triage",
  "planning",
  "building",
  "reviewing",
  "handoff",
  "complete",
  "cancelled",
]);
export type Stage = z.infer<typeof stageSchema>;

export const holdKindSchema = z.enum([
  "approval",
  "question",
  "attention",
  "dependency",
  "capacity",
  "paused",
  "taken",
]);
export type HoldKind = z.infer<typeof holdKindSchema>;

/**
 * Whether an item's start and plan approvals follow its autonomy level, for a trusted requester's
 * request, or are always needed.
 */
export const approvalsSchema = z.enum(["level", "always"]);
export type Approvals = z.infer<typeof approvalsSchema>;

/** The reasons of the two approval holds, by which kozod tells a start from a plan approval. */
export const startApprovalReason = "start approval";
export const planApprovalReason = "plan approval";

export const runStateSchema = z.enum([
  "queued",
  "running",
  "paused",
  "succeeded",
  "failed",
  "stopped",
  "lost",
]);
export type RunState = z.infer<typeof runStateSchema>;

export const riskTierSchema = z.enum(["low", "normal", "high"]);
export type RiskTier = z.infer<typeof riskTierSchema>;

export const agentNameSchema = z.enum([
  "triage",
  "plan",
  "implement",
  "review",
  "verify",
  "explorer",
]);
export type AgentName = z.infer<typeof agentNameSchema>;
