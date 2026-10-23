import { z } from "zod";
import { type ParseResult, parseYamlDocument } from "./document.ts";

const text = z.string().min(1);

export const evalOutcomeSchema = z.enum(["complete", "question", "split", "attention"]);
export type EvalOutcome = z.infer<typeof evalOutcomeSchema>;

/**
 * An eval case (D-046), `evals/<id>.yml` in the factory definition: a past request on a
 * repository at a start commit and the outcome the factory should reach on it. A case from a
 * public repository names the upstream issue and the hash of its body instead of copying it.
 */
export const evalCaseSchema = z.strictObject({
  version: z.literal(1),
  id: z.string().regex(/^[a-z0-9][a-z0-9._-]*$/),
  /** A registered repository by its path, its `github` name or the end of its path. */
  repository: text,
  /** A commit or a ref of that repository. */
  start: text,
  request: z.union([
    z.strictObject({ title: text, body: z.string() }),
    z.strictObject({
      title: text,
      issue: z.url(),
      bodySha256: z.string().regex(/^[0-9a-f]{64}$/),
    }),
  ]),
  expected: z.strictObject({
    outcome: evalOutcomeSchema,
    /** Why the outcome is the right one, for a human reading the case. */
    why: text.optional(),
    /** What the factory must not do, which a human judges from the run. */
    forbidden: z.array(text).optional(),
    /** The command that installs what the checks need; the constraints' prepare when unset. */
    prepare: text.optional(),
    /** Tests the factory never saw, laid over the result before the checks. */
    hidden: z
      .union([
        z.strictObject({ commit: text, paths: z.array(text).nonempty() }),
        /** Each path in the repository, by the file beside the case that it comes from. */
        z.strictObject({ files: z.record(text, text) }),
      ])
      .optional(),
    checks: z.array(text).optional(),
    /** The fix a human made, a commit or a patch beside the case, for a human to compare. */
    reference: text.optional(),
  }),
});
export type EvalCase = z.infer<typeof evalCaseSchema>;

export function parseEvalCase(text: string): ParseResult<EvalCase> {
  return parseYamlDocument(evalCaseSchema, text);
}
