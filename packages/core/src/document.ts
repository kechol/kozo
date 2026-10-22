import { z } from "zod";

export type ParseResult<T> = { ok: true; value: T } | { ok: false; issues: string[] };

function parseText<S extends z.ZodType>(
  schema: S,
  text: string,
  parse: (text: string) => unknown,
): ParseResult<z.output<S>> {
  let data: unknown;
  try {
    data = parse(text);
  } catch (error) {
    return { ok: false, issues: [`<document>: ${(error as Error).message}`] };
  }
  const result = schema.safeParse(data);
  if (result.success) return { ok: true, value: result.data };
  return { ok: false, issues: result.error.issues.map(issueText) };
}

/** One schema issue as `path: message`, the way every document problem is reported. */
export const issueText = (issue: z.ZodError["issues"][number]) =>
  `${issue.path.join(".") || "<document>"}: ${issue.message}`;

export function parseYamlDocument<S extends z.ZodType>(schema: S, text: string) {
  return parseText(schema, text, Bun.YAML.parse);
}

export function parseJsonDocument<S extends z.ZodType>(schema: S, text: string) {
  return parseText(schema, text, JSON.parse);
}

/** The JSON Schema of `schema` in draft-07, the draft that Claude Code's structured output reads. */
export const jsonSchema = (schema: z.ZodType) =>
  z.toJSONSchema(schema, { target: "draft-7" }) as Record<string, unknown>;
