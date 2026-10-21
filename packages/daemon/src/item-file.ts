import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { type KozoHome, type WorkClass, workClassSchema } from "@kozo/core";
import { z } from "zod";

export interface ItemFile {
  repository: string;
  class: WorkClass | null;
  title: string;
  body: string;
}

const frontMatterSchema = z.strictObject({
  version: z.literal(1),
  repository: z.string().min(1),
  class: workClassSchema.optional(),
});

export function itemPath(home: KozoHome, ref: string): string {
  return join(home.items, `${ref}.md`);
}

/** The directory beside an item's file for its plan, questions, answers and handoff reports. */
export function itemDirectory(home: KozoHome, ref: string): string {
  return join(home.items, ref);
}

// A plain path stays readable; anything else is written as a JSON string, which YAML reads too.
const scalar = (value: string) => (/^[\w./~-]+$/.test(value) ? value : JSON.stringify(value));

export function formatItemFile(item: ItemFile): string {
  const front = [
    "version: 1",
    `repository: ${scalar(item.repository)}`,
    ...(item.class ? [`class: ${item.class}`] : []),
  ].join("\n");
  const body = item.body.trim();
  return `---\n${front}\n---\n\n# ${item.title}\n${body ? `\n${body}\n` : ""}`;
}

/** Reads an item file as a human may have edited it; the first heading is the title. */
export function parseItemFile(text: string): ItemFile {
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
  if (!match) throw new Error("the item file has no front matter");
  const front = frontMatterSchema.parse(Bun.YAML.parse(match[1] ?? ""));
  const rest = (match[2] ?? "").replace(/^\s+/, "");
  const heading = /^# (.+)\n?/.exec(rest);
  if (!heading?.[1]) throw new Error("the item file has no # title");
  return {
    repository: front.repository,
    class: front.class ?? null,
    title: heading[1].trim(),
    body: rest.slice(heading[0].length).trim(),
  };
}

export async function writeItemFile(home: KozoHome, ref: string, item: ItemFile) {
  await mkdir(home.items, { recursive: true });
  await Bun.write(itemPath(home, ref), formatItemFile(item));
}

export async function readItemFile(home: KozoHome, ref: string): Promise<ItemFile> {
  return parseItemFile(await Bun.file(itemPath(home, ref)).text());
}
