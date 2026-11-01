import {
  defaultBranchRuleset,
  type FactoryState,
  type ItemState,
  itemStage,
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
): string {
  const waiting = item.hold
    ? ` and waits for ${item.hold.kind}: ${quiet(render(item.hold.reason, "en"))}`
    : "";
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

/** The install pull request's body: what it adds, what to do next and the ruleset to apply. */
export function installBody(repository: string, written: readonly string[]): string {
  return [
    "This adds what kozo needs in this repository:",
    "",
    ...written.map((path) => `- \`${path}\``),
    "",
    "Before merging, describe the repository in `AGENTS.md`, replace the commands in `.kozo/constraints.yml` and `.kozo/verify-app.md` with the repository's own, read every setting in `.kozo/charter.yml` and set its `status` to `ready`. kozo works here only after that.",
    "",
    "kozo does not change the repository's settings. To protect the default branch so that changes reach it only through pull requests that pass `kozo check`, an admin can apply this ruleset:",
    "",
    "```sh",
    `gh api --method POST repos/${repository}/rulesets --input - <<'EOF'`,
    JSON.stringify(defaultBranchRuleset, null, 2),
    "EOF",
    "```",
  ].join("\n");
}
