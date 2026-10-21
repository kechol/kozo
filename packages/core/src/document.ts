import type { z } from "zod";

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
  return {
    ok: false,
    issues: result.error.issues.map(
      (issue) => `${issue.path.join(".") || "<document>"}: ${issue.message}`,
    ),
  };
}

export function parseYamlDocument<S extends z.ZodType>(schema: S, text: string) {
  return parseText(schema, text, Bun.YAML.parse);
}

export function parseJsonDocument<S extends z.ZodType>(schema: S, text: string) {
  return parseText(schema, text, JSON.parse);
}
