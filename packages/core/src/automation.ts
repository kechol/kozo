import { z } from "zod";
import { type WorkClass, workClassSchema } from "./charter.ts";
import { parseSchedule, type Schedule } from "./cron.ts";

const frontMatterSchema = z.strictObject({
  version: z.literal(1),
  schedule: z.string().min(1),
  repository: z.string().min(1).optional(),
  class: workClassSchema.optional(),
});

/** An `automations/<name>.md` file of the factory definition: a request on a schedule. */
export interface Automation {
  name: string;
  schedule: Schedule;
  /** The registered repository the item is for; the only one there is when unset. */
  repository: string | null;
  class: WorkClass | null;
  title: string;
  body: string;
}

/** Parses an automation's file: YAML front matter, then the request under a `# <title>`. */
export function parseAutomation(name: string, text: string): Automation {
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
  if (!match) throw new Error("the automation starts with YAML front matter between --- lines");
  const front = frontMatterSchema.parse(Bun.YAML.parse(match[1] ?? ""));
  const schedule = parseSchedule(front.schedule);
  if (typeof schedule === "string") throw new Error(`schedule: ${schedule}`);
  const rest = (match[2] ?? "").replace(/^\s+/, "");
  const heading = /^# (.+)\n?/.exec(rest);
  if (!heading?.[1]) throw new Error("the request has no # title");
  return {
    name,
    schedule,
    repository: front.repository ?? null,
    class: front.class ?? null,
    title: heading[1].trim(),
    body: rest.slice(heading[0].length).trim(),
  };
}
