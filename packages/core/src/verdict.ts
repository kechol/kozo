import { z } from "zod";

export const reviewVerdictSchema = z.enum(["accept", "revise", "escalate"]);
export type ReviewVerdict = z.infer<typeof reviewVerdictSchema>;

export const findingSchema = z.strictObject({
  criterion: z.enum(["instructions", "scope", "tests", "conventions"]),
  /** Blocking findings justify revise or escalate; minor ones may stand with accept. */
  severity: z.enum(["blocking", "minor"]),
  path: z.string().min(1).optional(),
  issue: z.string().min(1),
});
export type Finding = z.infer<typeof findingSchema>;

/** What the review judge must answer, checked before anything is recorded. */
export const reviewJudgmentSchema = z.strictObject({
  verdict: reviewVerdictSchema,
  summary: z.string().min(1),
  findings: z.array(findingSchema),
});
export type ReviewJudgment = z.infer<typeof reviewJudgmentSchema>;

export const reviewRecordSchema = reviewJudgmentSchema.extend({
  model: z.string().min(1),
  costUsd: z.number().nonnegative(),
  /** The merge base and the head commit of the reviewed diff. */
  base: z.string().min(1),
  head: z.string().min(1),
  reviewedAt: z.iso.datetime(),
});
export type ReviewRecord = z.infer<typeof reviewRecordSchema>;

/** The verdicts of one run's judges, persisted as `verdict.json` in the run directory. */
export const verdictFileSchema = z.strictObject({
  version: z.literal(1),
  review: reviewRecordSchema.optional(),
});
export type VerdictFile = z.infer<typeof verdictFileSchema>;

/** The judgment schema as draft-07 JSON Schema, the draft Claude Code's structured output reads. */
export const reviewJudgmentJsonSchema = z.toJSONSchema(reviewJudgmentSchema, {
  target: "draft-7",
}) as Record<string, unknown>;
