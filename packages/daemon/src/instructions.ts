import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { KozoHome } from "@kozo/core";
import { itemDirectory } from "./item-file.ts";

/**
 * What a human said about an item or a task, kept for the runs that follow, and what kozod's
 * own check found after a merge. A `check` note holds command output that the diff's code can
 * shape, so it is never treated as the owner's word.
 */
export interface HumanNote {
  ts: string;
  /** The item or task reference the note is about. */
  target: string;
  kind: "answer" | "instruction" | "approval" | "rejection" | "check";
  text: string;
}

/** The notes that are the owner's own words, for the instructions of later runs and judges. */
export const ownersWords = (notes: readonly HumanNote[]) =>
  notes.filter((note) => note.kind !== "check");

const notesPath = (home: KozoHome, item: string) => join(itemDirectory(home, item), "notes.jsonl");

export async function addHumanNote(home: KozoHome, item: string, note: Omit<HumanNote, "ts">) {
  await mkdir(itemDirectory(home, item), { recursive: true });
  const line: HumanNote = { ts: new Date().toISOString(), ...note };
  await appendFile(notesPath(home, item), `${JSON.stringify(line)}\n`);
}

/** The notes about `targets`, oldest first. */
export async function humanNotes(home: KozoHome, item: string, targets: readonly string[]) {
  const file = Bun.file(notesPath(home, item));
  if (!(await file.exists())) return [];
  return (await file.text())
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as HumanNote)
    .filter((note) => targets.includes(note.target));
}

/** Appends an instruction to a running run's queue, which its worker reads at turn boundaries. */
export async function enqueue(queue: string, text: string) {
  await appendFile(queue, `${JSON.stringify({ ts: new Date().toISOString(), text })}\n`);
}
