import { z } from "zod";
import { workClassSchema } from "./charter.ts";
import { jsonSchema, type ParseResult, parseYamlDocument } from "./document.ts";
import { itemReferenceSchema } from "./reference.ts";
import { riskTierSchema } from "./work-model.ts";

const text = z.string().min(1);
const conditions = z.array(text).nonempty();
const taskId = z.string().regex(/^t[1-9][0-9]*$/, "issue.task-id");

export const planTaskSchema = z.strictObject({
  id: taskId,
  goal: text,
  done_when: conditions,
  scope: z.array(text).nonempty(),
  depends_on: z.array(taskId),
  estimate: z.strictObject({ lines: z.int().positive(), files: z.int().positive() }),
  /** The task adds tests that pin behaviour the item keeps, and changes nothing else. */
  characterize: z.boolean().optional(),
  /**
   * A command that kozod runs in the worktree before the implement session, never the agent. It
   * is printable ASCII on one line, so the plan a human approves shows all of it as it runs:
   * no control, bidirectional or invisible character can hide part of it.
   */
  codemod: text.regex(/^[\x20-\x7e]+$/, "issue.codemod-line").optional(),
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
        message: "issue.task-twice",
        params: { id: task.id },
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

// The API takes a tool's input schema only as one object at the top, without oneOf, so the
// session answers in this flat shape and triageAnswerSchema checks the combination after.
const triageAnswerWire = z.strictObject({
  outcome: z.enum(["plan", "question"]),
  plan: z.strictObject(draftFields).optional(),
  question: z.string().min(1).optional(),
});

export const triageAnswerJsonSchema = jsonSchema(triageAnswerWire);
