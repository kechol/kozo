import {
  defaultBranchRuleset,
  type FactoryState,
  type HoldKind,
  type ItemState,
  itemStage,
  type Locale,
  message,
  render,
} from "@kozo/core";

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
  locale: Locale,
): string {
  const say = (said: Parameters<typeof render>[0]) => render(said, locale);
  const kind = (hold: HoldKind) => message(`hold-kind.${hold}`);
  const stage = itemStage(state, item);
  const lines = [
    item.hold
      ? say(
          message("github.status-waiting", {
            item: item.ref,
            stage,
            hold: kind(item.hold.kind),
            reason: quiet(say(item.hold.reason)),
          }),
        )
      : say(message("github.status", { item: item.ref, stage })),
  ];
  if (item.tasks.length > 0) {
    lines.push("", say(message("github.table")), "| --- | --- | --- |");
    for (const ref of item.tasks) {
      const task = state.tasks[ref];
      if (!task) continue;
      const shown = task.hold
        ? say(message("github.task-waits", { stage: task.stage, hold: kind(task.hold.kind) }))
        : task.stage;
      lines.push(`| ${ref} | ${shown} | ${pulls.get(ref) ?? "-"} |`);
    }
  }
  lines.push("", say(message("github.cost", { cost: costUsd.toFixed(2) })));
  return lines.join("\n");
}

/** The install pull request's body: what it adds, what to do next and the ruleset to apply. */
export function installBody(
  repository: string,
  written: readonly string[],
  locale: Locale,
): string {
  return render(
    message("github.install-body", {
      files: written.map((path) => `- \`${path}\``).join("\n"),
      repository,
      ruleset: JSON.stringify(defaultBranchRuleset, null, 2),
    }),
    locale,
  );
}
