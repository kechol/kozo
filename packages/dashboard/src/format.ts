/** How long ago `iso` was, in the largest whole unit, as "3 h ago". */
export function ago(iso: string, now: Date = new Date()): string {
  const seconds = Math.max(0, Math.round((now.getTime() - Date.parse(iso)) / 1000));
  if (seconds < 60) return "just now";
  const units: [number, string][] = [
    [86_400, "d"],
    [3600, "h"],
    [60, "min"],
  ];
  for (const [size, name] of units) {
    if (seconds >= size) return `${Math.floor(seconds / size)} ${name} ago`;
  }
  return "just now";
}

export const usd = (amount: number) => `$${amount.toFixed(2)}`;

/** The page a hash names: the inbox or the board. */
export type Route = { page: "inbox" } | { page: "board" };

export function routeOf(hash: string): Route {
  return hash === "#/board" ? { page: "board" } : { page: "inbox" };
}

/** The stages in the order work moves through them, as the board's columns. */
export const stages = [
  "intake",
  "triage",
  "planning",
  "building",
  "reviewing",
  "handoff",
  "complete",
  "cancelled",
] as const;

export const isClosedStage = (stage: string) => stage === "complete" || stage === "cancelled";

/**
 * Where to move the card at `index` of a column one place up or down, as the `before` of a
 * reorder: before the card above, or before the card two below, else before the next open item
 * after the column in the factory's order, or to the end.
 */
export function moveTarget(
  column: readonly string[],
  order: readonly string[],
  index: number,
  direction: "up" | "down",
): string | null | undefined {
  if (direction === "up") return index > 0 ? column[index - 1] : undefined;
  const below = column[index + 1];
  if (below === undefined) return undefined;
  const second = column[index + 2];
  if (second !== undefined) return second;
  return order[order.indexOf(below) + 1] ?? null;
}
