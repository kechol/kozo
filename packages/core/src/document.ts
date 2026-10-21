import type { z } from "zod";

export type ParseResult<T> = { ok: true; value: T } | { ok: false; issues: string[] };

export function parseYamlDocument<S extends z.ZodType>(
  schema: S,
  text: string,
): ParseResult<z.output<S>> {
  let data: unknown;
  try {
    data = Bun.YAML.parse(text);
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
