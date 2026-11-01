import { z } from "zod";
import { gateLevelSchema } from "./constraints.ts";
import { type ParseResult, parseYamlDocument } from "./document.ts";

/** Every node a blueprint can run from Building to Handoff, in the only order they run in. */
export const blueprintNodes = [
  "claim",
  "prepare",
  "brief",
  "implement",
  "verify-deterministic",
  "review",
  "verify-app",
  "handoff",
  "final-verify",
] as const;
export type BlueprintNode = (typeof blueprintNodes)[number];

export const blueprintSchema = z
  .strictObject({
    version: z.literal(1),
    nodes: z.array(z.enum(blueprintNodes)).nonempty(),
    /** Whether the implement node starts from a failing test, which prove then checks. */
    reproduce: z.boolean(),
    /** The gate level the deterministic check runs at least at, whatever the risk tier. */
    gates: gateLevelSchema.optional(),
  })
  .superRefine((blueprint, context) => {
    // Every node holds one of the factory's guarantees, and whether verify-app runs is the risk
    // tier's to decide, so a blueprint lists them all.
    if (blueprint.nodes.join(" ") !== blueprintNodes.join(" ")) {
      context.addIssue({
        code: "custom",
        path: ["nodes"],
        message: `List every node in the order ${blueprintNodes.join(", ")}; the risk tier decides whether verify-app runs`,
      });
    }
  });
export type Blueprint = z.infer<typeof blueprintSchema>;

export function parseBlueprint(text: string): ParseResult<Blueprint> {
  return parseYamlDocument(blueprintSchema, text);
}
