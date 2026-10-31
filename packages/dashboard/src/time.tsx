import { ago } from "./format.ts";

/** One formatter serves every time on the page. */
const exact = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
const clock = new Intl.DateTimeFormat(undefined, { timeStyle: "medium" });

/**
 * A moment, as how long ago it was or as the time of day, with the exact time on hover; a value
 * that is not a time shows nothing rather than stopping the page.
 */
export function Time({ iso, as = "ago" }: { iso: string; as?: "ago" | "clock" }) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return (
    <time dateTime={iso} title={exact.format(date)}>
      {as === "ago" ? ago(iso) : clock.format(date)}
    </time>
  );
}
