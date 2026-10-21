import { z } from "zod";
import { type ParseResult, parseYamlDocument } from "./document.ts";

export const gateLevelSchema = z.enum(["fast", "full", "deep"]);
export type GateLevel = z.infer<typeof gateLevelSchema>;

// Gate names are joined with commas on the KOZO_GATES line, so they stay within this alphabet.
const gateName = z.string().regex(/^[a-z][a-z0-9-]*$/, "Use lowercase letters, digits and -");

const levelGates = z
  .array(gateName)
  .nonempty()
  .refine((names) => new Set(names).size === names.length, "List each gate once");

// A level may be absent here; running an absent level is MISCONFIGURED rather than a parse error.
export const constraintsSchema = z
  .strictObject({
    version: z.literal(1),
    prepare: z.array(z.string().min(1)).default([]),
    // Required: a guessed default could miss test helpers and let a diff edit them unnoticed.
    tests: z.array(z.string().min(1)).nonempty(),
    gates: z.record(gateName, z.strictObject({ run: z.string().min(1) })),
    levels: z.partialRecord(gateLevelSchema, levelGates),
    prove: z
      .array(
        z.strictObject({
          files: z.array(z.string().min(1)).nonempty(),
          run: z.string().includes("{files}", { message: "Put {files} where the test files go" }),
        }),
      )
      .default([]),
  })
  .superRefine((constraints, context) => {
    for (const [level, names] of Object.entries(constraints.levels)) {
      names?.forEach((name, index) => {
        if (!Object.hasOwn(constraints.gates, name)) {
          context.addIssue({
            code: "custom",
            path: ["levels", level, index],
            message: `Gate "${name}" is not defined in gates`,
          });
        }
      });
    }
  });
export type Constraints = z.infer<typeof constraintsSchema>;

export function parseConstraints(text: string): ParseResult<Constraints> {
  return parseYamlDocument(constraintsSchema, text);
}
