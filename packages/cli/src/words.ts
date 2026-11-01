import { kozoHome, type Locale, type MessageCode, message, render } from "@kozo/core";
import { definitionTip, readDefinition } from "@kozo/verify";

/** The values a message of `Code` takes, as the rest arguments of `message`. */
type ValuesOf<Code extends MessageCode> =
  Parameters<typeof message<Code>> extends [unknown, ...infer Rest] ? Rest : never;

/** The sentence of a message in the locale it was made for. */
export type Words = (<Code extends MessageCode>(
  code: Code,
  ...values: ValuesOf<Code>
) => string) & {
  readonly locale: Locale;
};

/** The words of everything the CLI says itself, in `locale`. */
export function words(locale: Locale): Words {
  const say = <Code extends MessageCode>(code: Code, ...values: ValuesOf<Code>) =>
    render(message(code, ...(values as never)), locale);
  return Object.assign(say, { locale });
}

export const english = words("en");

/** The locale of the factory definition, or `en` when it cannot be read. */
export async function factoryLocale(): Promise<Locale> {
  try {
    const factory = kozoHome().factory;
    const result = await readDefinition(factory, await definitionTip(factory));
    return result.ok ? result.definition.factory.locale : "en";
  } catch {
    return "en";
  }
}
