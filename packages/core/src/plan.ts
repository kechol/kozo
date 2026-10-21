import { z } from "zod";
import { workClassSchema } from "./charter.ts";
import { type ParseResult, parseYamlDocument } from "./document.ts";
import { itemReferenceSchema } from "./reference.ts";
import { riskTierSchema } from "./work-model.ts";

const text = z.string().min(1);
const conditions = z.array(text).nonempty();
const taskId = z.string().regex(/^t[1-9][0-9]*$/, "Use t<n>");

export const planTaskSchema = z.strictObject({
  id: taskId,
  goal: text,
  done_when: conditions,
  scope: z.array(text).nonempty(),
  depends_on: z.array(taskId),
  estimate: z.strictObject({ lines: z.int().positive(), files: z.int().positive() }),
});
export type PlanTask = z.infer<typeof planTaskSchema>;

const draftFields = {
  class: workClassSchema,
  risk: riskTierSchema,
  approach: text,
  done_when: conditions,
  tasks: z.array(planTaskSchema).nonempty(),
};

/** Task IDs are unique, and a task depends only on other tasks of the same plan. */
function checkTasks(plan: { tasks: PlanTask[] }, context: z.RefinementCtx) {
  const ids = new Set<string>();
  plan.tasks.forEach((task, index) => {
    if (ids.has(task.id)) {
      context.addIssue({
        code: "custom",
        path: ["tasks", index, "id"],
        message: `Task ${task.id} is listed twice`,
      });
    }
    ids.add(task.id);
  });
  plan.tasks.forEach((task, index) => {
    task.depends_on.forEach((dependency, position) => {
      const message =
        dependency === task.id
          ? "A task cannot depend on itself"
          : ids.has(dependency)
            ? null
            : `Task ${dependency} is not in the plan`;
      if (message) {
        context.addIssue({
          code: "custom",
          path: ["tasks", index, "depends_on", position],
          message,
        });
      }
    });
  });
}

// Only the plan's own shape is checked here; the split rules against the Charter belong to kozod.
export const planSchema = z
  .strictObject({ version: z.literal(1), item: itemReferenceSchema, ...draftFields })
  .superRefine(checkTasks);
export type Plan = z.infer<typeof planSchema>;

export function parsePlan(text: string): ParseResult<Plan> {
  return parseYamlDocument(planSchema, text);
}

/** The plan a triage agent drafts; kozod adds the version and the item. */
export const planDraftSchema = z.strictObject(draftFields).superRefine(checkTasks);
export type PlanDraft = z.infer<typeof planDraftSchema>;

/** What a triage session answers: a plan draft, or the question that blocks one. */
export const triageAnswerSchema = z.discriminatedUnion("outcome", [
  z.strictObject({ outcome: z.literal("plan"), plan: planDraftSchema }),
  z.strictObject({ outcome: z.literal("question"), question: z.string().min(1) }),
]);
export type TriageAnswer = z.infer<typeof triageAnswerSchema>;

// Draft-07 is the JSON Schema draft that Claude Code's structured output reads.
export const triageAnswerJsonSchema = z.toJSONSchema(triageAnswerSchema, {
  target: "draft-7",
}) as Record<string, unknown>;
