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

// Only the plan's own shape is checked here; the split rules against the Charter belong to kozod.
export const planSchema = z
  .strictObject({
    version: z.literal(1),
    item: itemReferenceSchema,
    class: workClassSchema,
    risk: riskTierSchema,
    approach: text,
    done_when: conditions,
    tasks: z.array(planTaskSchema).nonempty(),
  })
  .superRefine((plan, context) => {
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
  });
export type Plan = z.infer<typeof planSchema>;

export function parsePlan(text: string): ParseResult<Plan> {
  return parseYamlDocument(planSchema, text);
}
