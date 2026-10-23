/**
 * A five-field cron schedule (minute, hour, day of month, month, day of week) with numbers,
 * `*`, lists, ranges and steps. As in cron, a time matches a schedule that restricts both days
 * when either day field matches.
 */
export interface Schedule {
  matches(time: Date): boolean;
}

const fields = [
  { name: "minute", min: 0, max: 59 },
  { name: "hour", min: 0, max: 23 },
  { name: "day of month", min: 1, max: 31 },
  { name: "month", min: 1, max: 12 },
  // 7 is Sunday as well as 0.
  { name: "day of week", min: 0, max: 7 },
] as const;

/** The values a field allows, or why it allows none. */
function values(text: string, field: (typeof fields)[number]): Set<number> | string {
  const allowed = new Set<number>();
  for (const part of text.split(",")) {
    const match = /^(\*|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/.exec(part);
    if (!match) return `the ${field.name} field has "${part}", not a number, range, list or step`;
    const [, all, first, last, step] = match;
    const from = all === "*" ? field.min : Number(first);
    const to =
      all === "*" ? field.max : last === undefined ? (step ? field.max : from) : Number(last);
    const by = step === undefined ? 1 : Number(step);
    if (from < field.min || to > field.max || from > to || by < 1)
      return `the ${field.name} field allows ${field.min} to ${field.max}, not "${part}"`;
    for (let value = from; value <= to; value += by) allowed.add(value);
  }
  return allowed;
}

/** The schedule of a cron expression, or why it is not one. */
export function parseSchedule(expression: string): Schedule | string {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== fields.length)
    return `a schedule has five fields (minute hour day-of-month month day-of-week), not ${parts.length}`;
  const sets: Set<number>[] = [];
  for (const [index, field] of fields.entries()) {
    const allowed = values(parts[index] ?? "", field);
    if (typeof allowed === "string") return allowed;
    sets.push(allowed);
  }
  const [minutes, hours, days, months, weekdays] = sets as [
    Set<number>,
    Set<number>,
    Set<number>,
    Set<number>,
    Set<number>,
  ];
  if (weekdays.has(7)) weekdays.add(0);
  const anyDay = parts[2] === "*";
  const anyWeekday = parts[4] === "*";
  return {
    matches(time) {
      const day = days.has(time.getDate());
      const weekday = weekdays.has(time.getDay());
      const dayMatches = anyDay || anyWeekday ? day && weekday : day || weekday;
      return (
        minutes.has(time.getMinutes()) &&
        hours.has(time.getHours()) &&
        months.has(time.getMonth() + 1) &&
        dayMatches
      );
    },
  };
}
