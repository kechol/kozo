import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { KozoHome } from "@kozo/core";
import { itemDirectory } from "./item-file.ts";

/** What a human said about an item or a task, kept for the runs that follow. */
export interface HumanNote {
  ts: string;
  /** The item or task reference the note is about. */
  target: string;
  kind: "answer" | "instruction" | "approval" | "rejection";
  text: string;
}

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
