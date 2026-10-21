import { appendFile } from "node:fs/promises";
import type { FactoryState, Note } from "@kozo/core";

/** The notes about `targets` of an item, oldest first. */
export function notesAbout(state: FactoryState, item: string, targets: readonly string[]): Note[] {
  return (state.items[item]?.notes ?? []).filter((note) => targets.includes(note.target));
}

/**
 * The notes that are the owner's own words, for the instructions of later runs and judges. A
 * `check` note holds command output that the diff's code can shape, so it is never one.
 */
export const ownersWords = (notes: readonly Note[]) =>
  notes.filter((note) => note.kind !== "check");

/** Appends an instruction to a running run's queue, which its worker reads at turn boundaries. */
export async function enqueue(queue: string, text: string) {
  await appendFile(queue, `${JSON.stringify({ v: 1, ts: new Date().toISOString(), text })}\n`);
}
