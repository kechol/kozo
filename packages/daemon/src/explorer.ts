import {
  explorerAnswerJsonSchema,
  explorerAnswerSchema,
  itemStage,
  type KozoHome,
} from "@kozo/core";
import { baseOf, defuseSections, git, modelFor, SessionError } from "@kozo/verify";
import type { EventStore } from "./event-store.ts";
import { readItemFile, requestText } from "./item-file.ts";
import { recentLines } from "./queries.ts";
import { readCharter } from "./repository.ts";
import { type Runner, RunnerError } from "./runner.ts";
import { runRecords } from "./task-records.ts";
import { hasWorktree, worktreePath } from "./worktrees.ts";

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
    ...recentLines(store.db, itemRef, taskRef, recentEvents).map(({ ts, line }) => {
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
    for (const { run, report, decisions } of await runRecords(home, state, task)) {
      if (report) parts.push("", `RUN REPORT OF ${run}`, newest(JSON.stringify(report, null, 2)));
      if (decisions) parts.push("", `DECISION LOG OF ${run}`, newest(decisions));
    }
    const worktree = worktreePath(home, item.repository, task.ref);
    if (await hasWorktree(worktree)) {
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

/**
 * Answers a human's question about an item or one of its tasks from kozod's records, in an
 * explorer run of its own; nothing else about the subject changes.
 */
export async function askExplorer(
  runner: Runner,
  itemRef: string,
  taskRef: string | null,
  question: string,
): Promise<string> {
  const item = runner.store.state.items[itemRef];
  if (!item) throw new RunnerError(`${itemRef} does not exist`);
  const definition = runner.deps.definition.current;
  const { mode } = definition.factory;
  const { ref } = await baseOf(item.repository, mode);
  const tip = (await git(item.repository, ["rev-parse", ref])).trim();
  const charter = await readCharter(item.repository, mode, runner.store.state);
  const maxCostUsd = charter.ok ? charter.charter.limits.max_cost_usd : 1;
  const run = await runner.startRun({ item: itemRef, task: taskRef }, "explorer", tip, definition);
  const release = runner.reserve(maxCostUsd);
  try {
    const records = await explorerRecords(runner.home, runner.store, mode, itemRef, taskRef);
    const answer = await runner.deps.judge.judge({
      instructions: definition.agents.explorer.instructions,
      prompt: explorerPrompt(question, records),
      schema: explorerAnswerJsonSchema,
      model: modelFor(definition, "explorer"),
      maxCostUsd,
    });
    const parsed = explorerAnswerSchema.safeParse(answer.output);
    if (!parsed.success) {
      await runner.endRun(run, "failed", "the answer does not match its schema", answer.costUsd);
      throw new RunnerError("the explorer's answer does not match its schema");
    }
    await runner.endRun(run, "succeeded", undefined, answer.costUsd);
    return parsed.data.answer;
  } catch (error) {
    const spent = error instanceof SessionError ? error.costUsd : 0;
    await runner.endRun(run, "failed", String((error as Error).message).slice(0, 500), spent);
    throw error;
  } finally {
    release();
  }
}
