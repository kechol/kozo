import { type FactoryState, type ItemState, itemStage } from "@kozo/core";

// Words that close an Issue when a pull request with them in its body merges.
const closingKeywords = /\b(close[sd]?|fix(?:e[sd])?|resolve[sd]?)\b/gi;

/**
 * Text that an agent shaped, made safe to post: a zero-width space breaks every @mention, so
 * nobody is notified, and every closing keyword, so that merging a task cannot close the Issue
 * before kozod has checked DONE_WHEN.
 */
export function quiet(text: string): string {
  return text
    .replace(/@(?=[A-Za-z0-9])/g, "@​")
    .replace(closingKeywords, (word) => `${word.slice(0, 1)}​${word.slice(1)}`);
}

/** The status comment's body: the item's stage and hold, each task with its pull request, and the cost. */
export function statusBody(
  state: FactoryState,
  item: ItemState,
  pulls: ReadonlyMap<string, string>,
  costUsd: number,
): string {
  const waiting = item.hold ? ` and waits for ${item.hold.kind}: ${quiet(item.hold.reason)}` : "";
  const lines = [`**kozo**: ${item.ref} is in ${itemStage(state, item)}${waiting}.`];
  if (item.tasks.length > 0) {
    lines.push("", "| Task | Stage | Pull request |", "| --- | --- | --- |");
    for (const ref of item.tasks) {
      const task = state.tasks[ref];
      if (!task) continue;
      const held = task.hold ? ` (waits for ${task.hold.kind})` : "";
      lines.push(`| ${ref} | ${task.stage}${held} | ${pulls.get(ref) ?? "-"} |`);
    }
  }
  lines.push("", `Cost so far: ${costUsd.toFixed(2)} USD`);
  return lines.join("\n");
}
