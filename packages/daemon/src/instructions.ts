import { appendFile } from "node:fs/promises";
import type { FactoryState, Note } from "@kozo/core";

/**
 * What the owner said about `targets` of an item, oldest first. A `check` note holds command
 * output that the diff's code can shape, so it is never the owner's word; `checkNotes` has it.
 */
export function ownerNotes(state: FactoryState, item: string, targets: readonly string[]): Note[] {
  return (state.items[item]?.notes ?? []).filter(
    (note) => note.kind !== "check" && targets.includes(note.target),
  );
}

/**
 * What the owner said that a task's runs follow: what was said about the task, and about its
 * item from the acceptance of the task's plan on. What was said about the item before then
 * shaped the plan, which carries it into each task's GOAL and DONE_WHEN; given to every task of
 * a split item, it would ask each one for the whole item.
 */
export function taskOwnerNotes(state: FactoryState, task: string): Note[] {
  const current = state.tasks[task];
  if (!current) return [];
  return ownerNotes(state, current.item, [current.item, task]).filter(
    (note) => note.target === task || note.ts >= current.createdAt,
  );
}

/** What kozod's failed checks at Complete found about an item, oldest first. */
export function checkNotes(state: FactoryState, item: string): Note[] {
  return (state.items[item]?.notes ?? []).filter((note) => note.kind === "check");
}

/** Appends an instruction to a running run's queue, which its worker reads at turn boundaries. */
export async function enqueue(queue: string, text: string) {
  await appendFile(queue, `${JSON.stringify({ v: 1, ts: new Date().toISOString(), text })}\n`);
}
