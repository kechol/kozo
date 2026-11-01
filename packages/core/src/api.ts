import { createHmac, timingSafeEqual } from "node:crypto";
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
  "reorder",
  "issue",
]);
export type Verb = z.infer<typeof verbSchema>;

/** The verbs each kind of reference takes; any other pair is a 400. */
export const verbsByKind: Record<Reference["kind"], readonly Verb[]> = {
  item: ["say", "approve", "reject", "pause", "resume", "retry", "close", "reorder", "issue"],
  task: ["say", "pause", "resume", "retry", "close", "take", "return"],
  run: ["say", "pause", "resume"],
};

const text = z.string().trim().min(1);

/** The body of each verb. */
export const verbBodySchemas = {
  /** With `ask`, the text is a question that the explorer answers from the records instead. */
  say: z.strictObject({ text, ask: z.boolean().optional() }),
  approve: z.strictObject({ text: text.optional() }),
  reject: z.strictObject({ reason: text }),
  pause: z.strictObject({ now: z.boolean().optional() }),
  resume: z.strictObject({}),
  retry: z.strictObject({ text: text.optional() }),
  close: z.union([z.strictObject({ done: z.literal(true) }), z.strictObject({ cancel: text })]),
  take: z.strictObject({}),
  return: z.strictObject({ text }),
  /** Moves the item before another item, or to the end with null. */
  reorder: z.strictObject({ before: text.nullable() }),
  /** Moves a local item to an Issue of its repository, in GitHub mode. */
  issue: z.strictObject({}),
} satisfies Record<Verb, z.ZodType>;

export const addItemSchema = z.strictObject({
  title: text,
  body: z.string().optional(),
  /** A registered repository by its path; required when more than one is registered. */
  repository: text.optional(),
  class: workClassSchema.optional(),
});
export type AddItem = z.infer<typeof addItemSchema>;

export const installSchema = z.strictObject({
  /** A registered GitHub repository by its path. */
  repository: text,
});
export type Install = z.infer<typeof installSchema>;

export const pruneSchema = z.strictObject({
  /** Prunes the runs of items that closed at least this many days ago. */
  older_than_days: z.int().positive(),
  /** Lists what would go without removing it. */
  dry_run: z.boolean().optional(),
});
export type Prune = z.infer<typeof pruneSchema>;

/** Asks kozod to draft the eval case of a run's item. */
export const evalCaseRequestSchema = z.strictObject({ run: z.string().regex(/^r-\d{4,}$/) });
export type EvalCaseRequest = z.infer<typeof evalCaseRequestSchema>;

/** The JSON body of every error response: the sentence in kozod's locale, and its message. */
export interface ApiError {
  error: string;
  code: string;
  values: Record<string, unknown>;
  issues?: string[];
}

/**
 * What kozod answers to a client's random nonce at `/api/hello`: proof that it holds the API
 * token, so the client sends the token only to its own kozod and never to another program
 * that took the port while kozod was down.
 */
export function helloProof(token: string, nonce: string): string {
  return createHmac("sha256", token).update(`kozo-hello:${nonce}`).digest("hex");
}

/** Compares a secret given by the other side with the expected one in constant time. */
export function secretMatches(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
