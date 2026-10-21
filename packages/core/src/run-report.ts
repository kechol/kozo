import { z } from "zod";

const text = z.string().min(1);

/** Why an agent declared with `kozo_blocked` that it cannot go on. */
export const blockedReasonSchema = z.enum(["scope", "ambiguous", "environment", "missing-tool"]);
export type BlockedReason = z.infer<typeof blockedReasonSchema>;

const proposedTaskSchema = z.strictObject({
  goal: text,
  done_when: z.array(text).nonempty(),
  scope: z.array(text).nonempty(),
});

const common = {
  version: z.literal(1),
  summary: text,
  changes: z.array(text),
  /** What the agent noticed outside its scope and left alone, for the handoff report. */
  out_of_scope: z.array(z.strictObject({ path: text.optional(), note: text })),
  /** Test files the run added or changed, as paths relative to the repository root. */
  tests: z.array(text),
};

export const runReportSchema = z.discriminatedUnion("outcome", [
  z.strictObject({ ...common, outcome: z.literal("done") }),
  z.strictObject({
    ...common,
    outcome: z.literal("blocked"),
    blocked: z.discriminatedUnion("reason", [
      z.strictObject({
        reason: z.literal("scope"),
        question: text,
        split: z.array(proposedTaskSchema).optional(),
      }),
      z.strictObject({ reason: blockedReasonSchema.exclude(["scope"]), question: text }),
    ]),
  }),
]);
export type RunReport = z.infer<typeof runReportSchema>;

// Draft-07 is the JSON Schema draft that Claude Code's structured output reads.
export const runReportJsonSchema = z.toJSONSchema(runReportSchema, {
  target: "draft-7",
}) as Record<string, unknown>;
