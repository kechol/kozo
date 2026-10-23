/** How long ago `iso` was, in the largest whole unit, as "3 h ago". */
export function ago(iso: string, now: Date = new Date()): string {
  const seconds = Math.max(0, Math.round((now.getTime() - Date.parse(iso)) / 1000));
  if (seconds < 60) return "just now";
  const units: [number, string][] = [
    [86_400, "d"],
    [3600, "h"],
    [60, "min"],
  ];
  const [size, name] = units.find(([unitSize]) => seconds >= unitSize) ?? [60, "min"];
  return `${Math.floor(seconds / size)} ${name} ago`;
}

export const usd = (amount: number) => `$${amount.toFixed(2)}`;

/** The page a hash names: the inbox, the board, or one reference's detail. */
export type Route = { page: "inbox" } | { page: "board" } | { page: "detail"; ref: string };

export function routeOf(hash: string): Route {
  if (hash === "#/board") return { page: "board" };
  const detail = /^#\/ref\/(.+)$/.exec(hash);
  if (!detail?.[1]) return { page: "inbox" };
  try {
    return { page: "detail", ref: decodeURIComponent(detail[1]) };
  } catch {
    return { page: "inbox" };
  }
}

export const detailHash = (ref: string) => `#/ref/${encodeURIComponent(ref)}`;

/** The kind of a reference as kozo writes them: `r-0042`, `K-12/t1` or `app#212/t2`, else an item. */
export function kindOf(ref: string): "item" | "task" | "run" {
  if (/^r-\d+$/.test(ref)) return "run";
  return /\/t\d+$/.test(ref) ? "task" : "item";
}

/** One line for an event of the timeline: what happened, without its envelope. */
export function eventLine(event: { type: string; data: Record<string, unknown> }): string {
  const data = event.data;
  switch (event.type) {
    case "stage.changed":
      return `${data.target} ${data.from} → ${data.to}: ${data.reason}`;
    case "hold.set":
      return `${data.target} held for ${data.hold}: ${data.reason}`;
    case "hold.cleared":
      return `${data.target} ${data.hold} cleared${data.reason ? `: ${data.reason}` : ""}`;
    case "run.started":
      return `${data.agent} run started on ${data.model}`;
    case "run.changed":
      return `run ${data.from} → ${data.to}${data.reason ? `: ${data.reason}` : ""}`;
    case "node.enter":
      return "entered";
    case "node.exit":
      return `${data.ok ? "passed" : "failed"}${data.summary ? `: ${data.summary}` : ""}`;
    case "gates.result":
      return `${data.level} gates ${data.status}${data.failed ? ` at ${data.failed}` : ""}`;
    case "review.verdict":
      return `review: ${data.verdict}, ${data.summary}`;
    case "note.added":
      return `${data.kind}: ${data.text}`;
    case "agent.message":
      return String(data.text ?? "").split("\n")[0] ?? "";
    case "tool.call":
      return `called ${data.tool}`;
    case "guard.denied":
      return `the guard refused ${data.tool}: ${data.reason}`;
    case "handoff.ready":
      return `ready at ${String(data.head ?? "").slice(0, 12)}`;
    default:
      return "";
  }
}

/**
 * The stages in the order work moves through them, as the board's columns. They are listed here
 * rather than taken from @kozo/core, which would bring zod into the page; a test keeps them equal.
 */
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
