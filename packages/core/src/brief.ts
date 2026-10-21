import { z } from "zod";
import { workClassSchema } from "./charter.ts";
import { gateLevelSchema } from "./constraints.ts";
import { taskReferenceSchema } from "./reference.ts";

const text = z.string().min(1);
const list = z.array(text).nonempty();

/**
 * The fields of one run's brief. Every field is required and none may be empty; the REPORT
 * section is not a field because it always shows the current run report schema.
 */
export const briefSchema = z.strictObject({
  version: z.literal(1),
  goal: text,
  done_when: list,
  item: z
    .strictObject({
      goal: text,
      task: taskReferenceSchema,
      position: z.int().positive(),
      of: z.int().positive(),
      /** Summaries of the diffs of the tasks this one depends on. */
      prior_diffs: z.array(text),
    })
    .refine((item) => item.position <= item.of, "The position is past the number of tasks"),
  blueprint: z.strictObject({ class: workClassSchema, nodes: list }),
  scope: list,
  /** Changes outside the scope, including the scopes of later tasks, that the run must leave. */
  do_not_act: list,
  context: z.strictObject({
    files: z.array(text),
    decisions: z.array(text),
    rules: z.array(text),
  }),
  /** The request body as given; it is untrusted data and is shown only inside a request tag. */
  request: text,
  gates: gateLevelSchema,
  limits: z.strictObject({
    max_changed_lines: z.int().positive(),
    max_files: z.int().positive(),
    max_turns: z.int().positive(),
    max_minutes: z.int().positive(),
    max_cost_usd: z.number().positive(),
  }),
  forbidden: list,
});
export type Brief = z.infer<typeof briefSchema>;
