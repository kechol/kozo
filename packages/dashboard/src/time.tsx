import type { Locale } from "./api.ts";
import { ago } from "./format.ts";
import { locale } from "./words.ts";

const formats = new Map<string, Intl.DateTimeFormat>();

/** One formatter per locale and style serves every time on the page. */
function formatter(loc: Locale, style: "exact" | "clock"): Intl.DateTimeFormat {
  const key = `${loc} ${style}`;
  let format = formats.get(key);
  if (!format) {
    format = new Intl.DateTimeFormat(
      loc,
      style === "exact" ? { dateStyle: "medium", timeStyle: "short" } : { timeStyle: "medium" },
    );
    formats.set(key, format);
  }
  return format;
}

/**
 * A moment, as how long ago it was or as the time of day, with the exact time on hover; a value
 * that is not a time shows nothing rather than stopping the page.
 */
export function Time({ iso, as = "ago" }: { iso: string; as?: "ago" | "clock" }) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const loc = locale.value;
  return (
    <time dateTime={iso} title={formatter(loc, "exact").format(date)}>
      {as === "ago" ? ago(iso, new Date(), loc) : formatter(loc, "clock").format(date)}
    </time>
  );
}
