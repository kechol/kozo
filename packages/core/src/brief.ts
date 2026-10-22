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

/** Keeps request text from closing the tag it is wrapped in and posing as the brief. */
export function wrapRequest(body: string): string {
  return `<request trust="untrusted">\n${body.replace(/<\/(request)/gi, "<\\/$1")}\n</request>`;
}

const bullets = (items: readonly string[], indent = "            ") =>
  items.map((item, index) => `${index === 0 ? "" : indent}- ${item}`).join("\n");

/**
 * The brief as the agent reads it: every field under its fixed label, the request wrapped as
 * untrusted data, the gates level and the run report's schema.
 */
export function renderBrief(brief: Brief, { reportSchema }: { reportSchema: unknown }): string {
  const { item, limits, context } = brief;
  const contextLines = [
    ...context.files.map((file) => `file: ${file}`),
    ...context.decisions.map((decision) => `earlier decision: ${decision}`),
    ...context.rules.map((rule) => `rule: ${rule}`),
  ];
  return [
    `GOAL        ${brief.goal}`,
    `DONE_WHEN   ${bullets(brief.done_when)}`,
    `ITEM        ${item.goal}`,
    `            This is ${item.task}, task ${item.position} of ${item.of}.`,
    ...item.prior_diffs.map((diff) => `            Earlier task: ${diff}`),
    `BLUEPRINT   ${brief.blueprint.class}: ${brief.blueprint.nodes.join(" → ")}`,
    `SCOPE       ${bullets(brief.scope)}`,
    `DO_NOT_ACT  ${bullets(brief.do_not_act)}`,
    `CONTEXT     ${contextLines.length > 0 ? bullets(contextLines) : "- Read AGENTS.md first."}`,
    `REQUEST     ${wrapRequest(brief.request)}`,
    `GATES       Call kozo_gates with level ${brief.gates}; it must pass on your last commit.`,
    `LIMITS      ${limits.max_changed_lines} changed lines, ${limits.max_files} files, ${limits.max_turns} turns, ${limits.max_minutes} minutes, ${limits.max_cost_usd} USD`,
    `FORBIDDEN   ${bullets(brief.forbidden)}`,
    `REPORT      Finish by answering with the run report, which must match this JSON Schema:`,
    JSON.stringify(reportSchema),
  ].join("\n");
}
