import type { ParseResult } from "./document.ts";
import { type Event, parseEvent } from "./event.ts";

/**
 * Parses the text of one `events.jsonl`. Every line must parse and `seq` must count from 0
 * without gaps; an issue names the log and the line.
 */
export function parseEventLog(text: string, name: string): ParseResult<Event[]> {
  const events: Event[] = [];
  const issues: string[] = [];
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  lines.forEach((line, index) => {
    const where = `${name}:${index + 1}`;
    const result = parseEvent(line);
    if (!result.ok) {
      issues.push(...result.issues.map((issue) => `${where}: ${issue}`));
      return;
    }
    if (result.value.seq !== index) {
      issues.push(`${where}: seq is ${result.value.seq}, expected ${index}`);
    }
    events.push(result.value);
  });
  return issues.length > 0 ? { ok: false, issues } : { ok: true, value: events };
}

/** Merges the events of several logs into the order kozod wrote them, by their `ts`. */
export function mergeLogs(logs: readonly (readonly Event[])[]): Event[] {
  return logs.flat().sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
}
