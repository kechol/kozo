import { z } from "zod";
import { en } from "./messages/en.ts";
import { ja } from "./messages/ja.ts";

export const localeSchema = z.enum(["en", "ja"]);
export type Locale = z.infer<typeof localeSchema>;

export type MessageCode = keyof typeof en;

/** The names of the `{name}` values in a sentence. */
type Placeholders<Sentence extends string> =
  Sentence extends `${string}{${infer Name}}${infer Rest}` ? Name | Placeholders<Rest> : never;

type ValuesOf<Code extends MessageCode> = Placeholders<(typeof en)[Code]>;

const codes = Object.keys(en) as [MessageCode, ...MessageCode[]];

/** Text kozo words itself, kept as a code with values and rendered only when shown. */
export interface Message {
  code: MessageCode;
  /**
   * A value is text, a number, a message of its own that renders in the same locale, or a list
   * of messages that renders as one sentence after another.
   */
  values: Record<string, Value>;
}
type Value = string | number | Message | Message[];

export const messageSchema: z.ZodType<Message> = z.strictObject({
  code: z.enum(codes),
  values: z.record(
    z.string(),
    z.union([
      z.string(),
      z.number(),
      z.lazy(() => messageSchema),
      z.array(z.lazy(() => messageSchema)),
    ]),
  ),
});

/** The message of `code`, which takes exactly the values its English sentence names. */
export function message<Code extends MessageCode>(
  code: Code,
  ...values: [ValuesOf<Code>] extends [never] ? [] : [Record<ValuesOf<Code>, Value>]
): Message {
  return { code, values: values[0] ?? {} };
}

const catalogs: Record<Locale, Record<MessageCode, string>> = { en, ja };

// How a list of messages joins into one text.
const separators: Record<Locale, string> = { en: "; ", ja: "。" };

const languages: Record<Locale, string> = { en: "English", ja: "Japanese" };

/**
 * What an agent is told about the language of the prose it writes for people, or null in
 * English. Its prompt stays English; what kozod or a check compares stays as given.
 */
export function proseLanguage(locale: Locale): string | null {
  if (locale === "en") return null;
  return `Write the prose you give people in ${languages[locale]}: summaries, changes, questions, notes, findings and decisions, and a plan's approach, goals and conditions. Keep JSON keys, enum values, file paths, commands, code and identifiers exactly as they are, write code, comments and commit messages as the repository's own conventions ask, and when you repeat a condition or other text kozo gave you, copy it unchanged.`;
}

/** Whether `text` names a message, as a schema's own issue does. */
export const isMessageCode = (text: string): text is MessageCode => text in en;

/** The sentence of `message` in `locale`, with its values in place. */
export function render(message: Message, locale: Locale): string {
  return catalogs[locale][message.code].replace(/\{(\w+)\}/g, (_, name: string) => {
    const value = message.values[name] ?? "";
    if (Array.isArray(value))
      return value.map((entry) => render(entry, locale)).join(separators[locale]);
    return typeof value === "object" ? render(value, locale) : String(value);
  });
}
