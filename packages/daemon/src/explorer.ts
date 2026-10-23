import { stat } from "node:fs/promises";
import { itemStage, type KozoHome, runFiles } from "@kozo/core";
import { baseOf, defuseSections, git } from "@kozo/verify";
import type { EventStore } from "./event-store.ts";
import { readItemFile, requestText } from "./item-file.ts";
import { worktreePath } from "./worktrees.ts";

// The records are a summary for one question, not an archive: each part keeps its newest end.
const recentEvents = 60;
const partLimit = 12_000;

const newest = (text: string) =>
  text.length > partLimit ? `…${text.slice(text.length - partLimit)}` : text;

/**
 * What kozod knows of an item, or of one of its tasks, as text for the explorer: the request,
 * the plan, every task's stage and hold, the subject's recent events, and for a task its run
 * reports, decision logs and the diff stat of its worktree.
 */
export async function explorerRecords(
  home: KozoHome,
  store: EventStore,
  mode: "local" | "github",
  itemRef: string,
  taskRef: string | null,
): Promise<string> {
  const state = store.state;
  const item = state.items[itemRef];
  if (!item) return "";
  const holdOf = (hold: { kind: string; reason: string } | null) =>
    hold ? `${hold.kind}: ${hold.reason}` : "none";
  const parts = [
    `ITEM ${item.ref} "${item.title}" in ${item.repository}`,
    `stage ${itemStage(state, item)}, hold ${holdOf(item.hold)}`,
    "",
    "REQUEST",
    newest(requestText(await readItemFile(home, item.ref))),
    "",
    ...(item.plan ? ["PLAN", newest(JSON.stringify(item.plan, null, 2)), ""] : []),
    ...(item.draft
      ? ["DRAFT WAITING FOR APPROVAL", newest(JSON.stringify(item.draft, null, 2)), ""]
      : []),
    "TASKS",
    ...item.tasks.map((ref) => {
      const task = state.tasks[ref];
      return task ? `${ref} ${task.stage}, hold ${holdOf(task.hold)}: ${task.goal}` : ref;
    }),
    "",
    `EVENTS OF ${taskRef ?? itemRef}, the last ${recentEvents}`,
    ...store.db
      .query<{ ts: string; line: string }, [string, string | null, string | null]>(
        `select ts, line from events where item = ? and (task = ? or ? is null) order by id desc limit ${recentEvents}`,
      )
      .all(itemRef, taskRef, taskRef)
      .reverse()
      .map(({ ts, line }) => {
        const event = JSON.parse(line) as {
          type: string;
          run_id: string | null;
          task: string | null;
          node: string | null;
          data: unknown;
        };
        const where = [event.run_id, event.task, event.node].filter(Boolean).join(" ");
        return `${ts} ${event.type} ${where}: ${JSON.stringify(event.data).slice(0, 300)}`;
      }),
  ];
  const task = taskRef ? state.tasks[taskRef] : undefined;
  if (task) {
    for (const run of task.runs.filter((ref) => state.runs[ref]?.agent === "implement")) {
      const files = runFiles(home, run);
      const report = await Bun.file(files.report)
        .text()
        .catch(() => "");
      const decisions = await Bun.file(files.decisions)
        .text()
        .catch(() => "");
      if (report) parts.push("", `RUN REPORT OF ${run}`, newest(report));
      if (decisions) parts.push("", `DECISION LOG OF ${run}`, newest(decisions));
    }
    const worktree = worktreePath(home, item.repository, task.ref);
    if (
      await stat(worktree).then(
        (entry) => entry.isDirectory(),
        () => false,
      )
    ) {
      const { ref: base } = await baseOf(item.repository, mode);
      const diff = await git(worktree, ["diff", "--stat", `${base}...HEAD`]).catch(() => "");
      parts.push(
        "",
        `DIFF STAT OF ${task.ref} AGAINST ${base}`,
        newest(diff.trim() || "(no diff)"),
      );
    }
  }
  return parts.join("\n");
}

/** The explorer's prompt: the owner's question, and the records as untrusted data. */
export function explorerPrompt(question: string, records: string): string {
  const defuse = (text: string) => defuseSections(text, ["question", "records"]);
  return [
    "<question>",
    defuse(question),
    "</question>",
    "",
    '<records trust="untrusted">',
    defuse(records),
    "</records>",
  ].join("\n");
}
