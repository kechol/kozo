import type { Locale } from "./api.ts";
import { locale, say } from "./words.ts";

/** How long ago `iso` was, in the largest whole unit, as "3 h ago". */
export function ago(iso: string, now: Date = new Date(), loc: Locale = locale.value): string {
  const seconds = Math.max(0, Math.round((now.getTime() - Date.parse(iso)) / 1000));
  if (seconds < 60) return say(loc, "ago.now");
  const units = [
    [86_400, "ago.day"],
    [3600, "ago.hour"],
    [60, "ago.min"],
  ] as const;
  const [size, key] = units.find(([unitSize]) => seconds >= unitSize) ?? units[2];
  return say(loc, key, { n: Math.floor(seconds / size) });
}

const currencies = new Map<Locale, Intl.NumberFormat>();

/** An amount in US dollars, as the locale writes them. */
export function usd(amount: number, loc: Locale = locale.value): string {
  let format = currencies.get(loc);
  if (!format) {
    format = new Intl.NumberFormat(loc, { style: "currency", currency: "USD" });
    currencies.set(loc, format);
  }
  return format.format(amount);
}

/** What the board shows: items or tasks. */
export type BoardView = "items" | "tasks";

/** The page a hash names: the inbox, the board with what it shows, or one reference's detail. */
export type Route =
  | { page: "inbox" }
  | { page: "board"; view?: BoardView }
  | { page: "detail"; ref: string };

export function routeOf(hash: string): Route {
  const board = /^#\/board(?:\?view=(items|tasks))?$/.exec(hash);
  if (board) return board[1] ? { page: "board", view: board[1] as BoardView } : { page: "board" };
  const detail = /^#\/ref\/(.+)$/.exec(hash);
  if (!detail?.[1]) return { page: "inbox" };
  try {
    return { page: "detail", ref: decodeURIComponent(detail[1]) };
  } catch {
    return { page: "inbox" };
  }
}

export const detailHash = (ref: string) => `#/ref/${encodeURIComponent(ref)}`;

export const boardHash = (view: BoardView) => `#/board?view=${view}`;

/** The tab's title for a view, with how many wait in the inbox, so a background tab shows it. */
export function titleOf(route: Route, waiting: number, loc: Locale = locale.value): string {
  const view =
    route.page === "detail"
      ? route.ref
      : say(loc, route.page === "board" ? "nav.board" : "nav.inbox");
  return `${waiting > 0 ? `(${waiting}) ` : ""}${view} · kozo`;
}

/** The kind of a reference as kozo writes them: `r-0042`, `K-12/t1` or `app#212/t2`, else an item. */
export function kindOf(ref: string): "item" | "task" | "run" {
  if (/^r-\d+$/.test(ref)) return "run";
  return /\/t\d+$/.test(ref) ? "task" : "item";
}

/**
 * One line for an event of the timeline: what happened, without its envelope. The frame is the
 * page's own words; the reasons, summaries and texts inside it arrive from kozod in its locale.
 */
export function eventLine(
  event: { type: string; data: Record<string, unknown> },
  loc: Locale = locale.value,
): string {
  const data = event.data;
  const said = (suffix: unknown) => (suffix ? `: ${suffix}` : "");
  const text = (field: string) => String(data[field] ?? "");
  switch (event.type) {
    case "stage.changed":
      return `${data.target} ${data.from} → ${data.to}: ${data.reason}`;
    case "hold.set":
      return say(loc, "event.holdSet", {
        target: text("target"),
        hold: text("hold"),
        reason: text("reason"),
      });
    case "hold.cleared":
      return `${say(loc, "event.holdCleared", { target: text("target"), hold: text("hold") })}${said(data.reason)}`;
    case "run.started":
      return say(loc, "event.runStarted", { agent: text("agent"), model: text("model") });
    case "run.changed":
      return `${say(loc, "event.runChanged", { from: text("from"), to: text("to") })}${said(data.reason)}`;
    case "node.enter":
      return say(loc, "event.entered");
    case "node.exit":
      return `${say(loc, data.ok ? "event.passed" : "event.failed")}${said(data.summary)}`;
    case "gates.result":
      return data.failed
        ? say(loc, "event.gatesAt", {
            level: text("level"),
            status: text("status"),
            failed: text("failed"),
          })
        : say(loc, "event.gates", { level: text("level"), status: text("status") });
    case "review.verdict":
      return say(loc, "event.review", { verdict: text("verdict"), summary: text("summary") });
    case "note.added":
      return `${data.kind}: ${data.text}`;
    case "agent.message":
      return String(data.text ?? "").split("\n")[0] ?? "";
    case "tool.call":
      return say(loc, "event.called", { tool: text("tool") });
    case "guard.denied":
      return say(loc, "event.guard", { tool: text("tool"), reason: text("reason") });
    case "handoff.ready":
      return say(loc, "event.ready", { head: text("head").slice(0, 12) });
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

/** The work classes a new item may ask for, listed here for the same reason as the stages. */
export const workClasses = [
  "docs",
  "deps",
  "bugfix",
  "refactor",
  "perf",
  "migration",
  "feature",
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
