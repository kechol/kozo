import { createHash } from "node:crypto";
import type { ParseResult } from "./document.ts";
import { type Event, parseEvent } from "./event.ts";

/** The SHA-256 of `text` in hex, as a line's `prev` and the hashes in events carry it. */
export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** The events of one `events.jsonl` and the hash of its last line, null when it is empty. */
export interface EventLog {
  events: Event[];
  last: string | null;
}

/**
 * Parses the text of one `events.jsonl`. Every line must parse, `seq` must count from 0
 * without gaps, and `prev` must be the hash of the line before; an issue names the log and the
 * line.
 */
export function parseEventLog(text: string, name: string): ParseResult<EventLog> {
  const events: Event[] = [];
  const issues: string[] = [];
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  let last: string | null = null;
  lines.forEach((line, index) => {
    const where = `${name}:${index + 1}`;
    const expected = last;
    last = sha256(line);
    const result = parseEvent(line);
    if (!result.ok) {
      issues.push(...result.issues.map((issue) => `${where}: ${issue}`));
      return;
    }
    if (result.value.seq !== index) {
      issues.push(`${where}: seq is ${result.value.seq}, expected ${index}`);
    }
    if (result.value.prev !== expected) {
      issues.push(`${where}: prev does not match the line before`);
    }
    events.push(result.value);
  });
  return issues.length > 0 ? { ok: false, issues } : { ok: true, value: { events, last } };
}

/**
 * The text of a log without a last line that a crash cut short, one that ends without a newline
 * and does not parse, or null when it has none. No state ever applied such a line, since an
 * event is applied only after its whole line is written and synced.
 */
export function withoutTornLine(text: string): string | null {
  if (text === "" || text.endsWith("\n")) return null;
  const start = text.lastIndexOf("\n") + 1;
  return parseEvent(text.slice(start)).ok ? null : text.slice(0, start);
}

/**
 * The seals in `logs` that their run's log does not match: a run log that is missing, or
 * whose line count or last line differs from what kozod sealed when the run ended.
 */
export function sealIssues(logs: readonly EventLog[]): string[] {
  const runs = new Map<string, EventLog>();
  for (const log of logs) {
    const run = log.events[0]?.run_id;
    if (run) runs.set(run, log);
  }
  const issues: string[] = [];
  for (const event of logs.flatMap((log) => log.events)) {
    if (event.type !== "log.sealed") continue;
    const { run, lines, last } = event.data;
    const log = runs.get(run);
    if (!log) issues.push(`runs/${run}/events.jsonl is missing; it was sealed at ${event.ts}`);
    else if (log.events.length !== lines || log.last !== last)
      issues.push(
        `runs/${run}/events.jsonl does not match its seal: ${log.events.length} lines, sealed with ${lines}`,
      );
  }
  return issues;
}

/** Merges the events of several logs into the order kozod wrote them, by their `ts`. */
export function mergeLogs(logs: readonly (readonly Event[])[]): Event[] {
  return logs.flat().sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
}
