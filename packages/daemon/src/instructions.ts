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

/** What kozod's failed checks at Complete found about an item, oldest first. */
export function checkNotes(state: FactoryState, item: string): Note[] {
  return (state.items[item]?.notes ?? []).filter((note) => note.kind === "check");
}

/** Appends an instruction to a running run's queue, which its worker reads at turn boundaries. */
export async function enqueue(queue: string, text: string) {
  await appendFile(queue, `${JSON.stringify({ v: 1, ts: new Date().toISOString(), text })}\n`);
}
