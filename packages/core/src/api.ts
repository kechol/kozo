import { z } from "zod";
import { workClassSchema } from "./charter.ts";
import type { Reference } from "./reference.ts";

export const apiPort = 7420;

export const listKindSchema = z.enum(["inbox", "items", "tasks", "runs"]);
export type ListKind = z.infer<typeof listKindSchema>;

export const verbSchema = z.enum([
  "say",
  "approve",
  "reject",
  "pause",
  "resume",
  "retry",
  "close",
  "take",
  "return",
]);
export type Verb = z.infer<typeof verbSchema>;

/** The verbs each kind of reference takes; any other pair is a 400. */
export const verbsByKind: Record<Reference["kind"], readonly Verb[]> = {
  item: ["say", "approve", "reject", "pause", "resume", "retry", "close"],
  task: ["say", "pause", "resume", "retry", "close", "take", "return"],
  run: ["say", "pause", "resume"],
};

const text = z.string().trim().min(1);

/** The body of each verb. */
export const verbBodySchemas = {
  say: z.strictObject({ text }),
  approve: z.strictObject({ text: text.optional() }),
  reject: z.strictObject({ reason: text }),
  pause: z.strictObject({ now: z.boolean().optional() }),
  resume: z.strictObject({}),
  retry: z.strictObject({ text: text.optional() }),
  close: z.union([z.strictObject({ done: z.literal(true) }), z.strictObject({ cancel: text })]),
  take: z.strictObject({}),
  return: z.strictObject({ text }),
} satisfies Record<Verb, z.ZodType>;

export const addItemSchema = z.strictObject({
  title: text,
  body: z.string().optional(),
  /** A registered repository by its path; required when more than one is registered. */
  repository: text.optional(),
  class: workClassSchema.optional(),
});
export type AddItem = z.infer<typeof addItemSchema>;

/** The JSON body of every error response. */
export interface ApiError {
  error: string;
  issues?: string[];
}
