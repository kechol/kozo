import { z } from "zod";
import { type ParseResult, parseYamlDocument } from "./document.ts";
import type { Locale } from "./message.ts";

export const workClassSchema = z.enum([
  "docs",
  "deps",
  "bugfix",
  "refactor",
  "perf",
  "migration",
  "feature",
]);
export type WorkClass = z.infer<typeof workClassSchema>;

export const autonomyLevelSchema = z.enum(["L1", "L2", "L3"]);
export type AutonomyLevel = z.infer<typeof autonomyLevelSchema>;

const count = z.int().positive();
// Zero is a valid choice for retry counts: it sends the task to attention on the first failure.
const retries = z.int().nonnegative();

// No field has a default: a Charter with anything missing must stop the factory in that repository.
export const charterSchema = z.strictObject({
  version: z.literal(1),
  status: z.enum(["ready", "incomplete"]),
  // A worktree per task is the only isolation kozo has; a value that changed nothing would mislead.
  isolation: z.literal("worktree", { error: "issue.worktree-only" }),
  protected_paths: z.array(z.string().min(1)),
  existing_tests_protected: z.boolean(),
  levels: z.strictObject({
    default: autonomyLevelSchema,
    docs: autonomyLevelSchema.optional(),
    deps: autonomyLevelSchema.optional(),
    bugfix: autonomyLevelSchema.optional(),
    refactor: autonomyLevelSchema.optional(),
    perf: autonomyLevelSchema.optional(),
    migration: autonomyLevelSchema.optional(),
    feature: autonomyLevelSchema.optional(),
  }),
  limits: z.strictObject({
    max_changed_lines: count,
    max_files: count,
    max_tasks_per_item: count,
    inner_retries: retries,
    ci_fix_rounds: retries,
    no_progress_rounds: count,
    max_turns: count,
    max_minutes: count,
    max_cost_usd: z.number().positive(),
  }),
  backpressure: z.strictObject({
    max_awaiting_merge: count,
    max_held: count,
  }),
});
export type Charter = z.infer<typeof charterSchema>;

export function parseCharter(text: string, locale: Locale = "en"): ParseResult<Charter> {
  return parseYamlDocument(charterSchema, text, locale);
}
