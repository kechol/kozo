import { z } from "zod";

const agentFrontmatter = z.strictObject({
  name: z.string().min(1),
  description: z.string().min(1),
  model: z.string().min(1).optional(),
});

// Briefs choose the skills a session gets, so no skill may be invoked on the model's initiative.
const skillFrontmatter = z.strictObject({
  name: z.string().min(1),
  description: z.string().min(1),
  "disable-model-invocation": z.literal(true),
});

export interface AgentDefinition extends z.infer<typeof agentFrontmatter> {
  /** The instructions that become the session's system prompt. */
  instructions: string;
}

export interface Skill extends z.infer<typeof skillFrontmatter> {
  instructions: string;
}

/** Parses an `agents/<name>/agent.md` file: YAML frontmatter, then the instructions. */
export function parseAgentDefinition(text: string): AgentDefinition {
  return parseFrontmatterDocument(text, agentFrontmatter);
}

/** Parses a `skills/<name>/SKILL.md` file: YAML frontmatter, then the instructions. */
export function parseSkill(text: string): Skill {
  return parseFrontmatterDocument(text, skillFrontmatter);
}

function parseFrontmatterDocument<S extends z.ZodType<object>>(text: string, schema: S) {
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
  if (!match) throw new Error("the document starts with YAML frontmatter between --- lines");
  const frontmatter = schema.parse(Bun.YAML.parse(match[1] ?? ""));
  return { ...frontmatter, instructions: (match[2] ?? "").trim() };
}
