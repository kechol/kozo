import { z } from "zod";
import { isMessageCode, type Locale, type Message, render } from "./message.ts";

export type ParseResult<T> = { ok: true; value: T } | { ok: false; issues: string[] };

function parseText<S extends z.ZodType>(
  schema: S,
  text: string,
  parse: (text: string) => unknown,
  locale: Locale,
): ParseResult<z.output<S>> {
  let data: unknown;
  try {
    data = parse(text);
  } catch (error) {
    return { ok: false, issues: [`<document>: ${(error as Error).message}`] };
  }
  const result = schema.safeParse(data, errorsIn(locale));
  if (result.success) return { ok: true, value: result.data };
  return { ok: false, issues: result.error.issues.map((issue) => issueText(issue, locale)) };
}

/** What a parse in `locale` passes zod, so that zod's own issues are worded in it. */
export const errorsIn = (locale: Locale) =>
  locale === "en" ? undefined : { error: z.locales[locale]().localeError };

/**
 * One schema issue as `path: message`, the way every document problem is reported. kozo's own
 * issues name a message, with the issue's params as its values.
 */
export function issueText(issue: z.ZodError["issues"][number], locale: Locale = "en"): string {
  const params = (issue as { params?: Message["values"] }).params ?? {};
  const said = isMessageCode(issue.message)
    ? render({ code: issue.message, values: params }, locale)
    : issue.message;
  return `${issue.path.join(".") || "<document>"}: ${said}`;
}

export function parseYamlDocument<S extends z.ZodType>(
  schema: S,
  text: string,
  locale: Locale = "en",
) {
  return parseText(schema, text, Bun.YAML.parse, locale);
}

export function parseJsonDocument<S extends z.ZodType>(
  schema: S,
  text: string,
  locale: Locale = "en",
) {
  return parseText(schema, text, JSON.parse, locale);
}

/** The JSON Schema of `schema` in draft-07, the draft that Claude Code's structured output reads. */
export const jsonSchema = (schema: z.ZodType) =>
  z.toJSONSchema(schema, { target: "draft-7" }) as Record<string, unknown>;
