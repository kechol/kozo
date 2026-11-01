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
  /** A value is text, a number, or a message of its own that renders in the same locale. */
  values: Record<string, Value>;
}
type Value = string | number | Message;

export const messageSchema: z.ZodType<Message> = z.strictObject({
  code: z.enum(codes),
  values: z.record(z.string(), z.union([z.string(), z.number(), z.lazy(() => messageSchema)])),
});

/** The message of `code`, which takes exactly the values its English sentence names. */
export function message<Code extends MessageCode>(
  code: Code,
  ...values: [ValuesOf<Code>] extends [never] ? [] : [Record<ValuesOf<Code>, Value>]
): Message {
  return { code, values: values[0] ?? {} };
}

const catalogs: Record<Locale, Record<MessageCode, string>> = { en, ja };

/** The sentence of `message` in `locale`, with its values in place. */
export function render(message: Message, locale: Locale): string {
  return catalogs[locale][message.code].replace(/\{(\w+)\}/g, (_, name: string) => {
    const value = message.values[name] ?? "";
    return typeof value === "object" ? render(value, locale) : String(value);
  });
}
