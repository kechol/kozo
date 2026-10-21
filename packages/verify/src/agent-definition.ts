import { z } from "zod";

const frontmatterSchema = z.strictObject({
  name: z.string().min(1),
  description: z.string().min(1),
  model: z.string().min(1).optional(),
});

export interface AgentDefinition extends z.infer<typeof frontmatterSchema> {
  /** The instructions that become the session's system prompt. */
  instructions: string;
}

/** Parses an `agents/<name>/agent.md` file: YAML frontmatter, then the instructions. */
export function parseAgentDefinition(text: string): AgentDefinition {
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
  if (!match) throw new Error("an agent definition starts with YAML frontmatter between --- lines");
  const frontmatter = frontmatterSchema.parse(Bun.YAML.parse(match[1] ?? ""));
  return { ...frontmatter, instructions: (match[2] ?? "").trim() };
}
