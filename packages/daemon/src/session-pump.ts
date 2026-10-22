import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { runFiles } from "@kozo/core";
import { type AgentOutcome, recordTypes } from "@kozo/worker";
import type { EventStore } from "./event-store.ts";
import type { LaunchedSession } from "./launcher.ts";

export interface Envelope {
  run_id: string;
  item: string;
  task: string | null;
  parent_run?: string | null;
  node?: string | null;
}

type Ended = {
  [S in AgentOutcome["status"]]: { status: S; outcome: Extract<AgentOutcome, { status: S }> };
};

export type SessionResult =
  | Ended[AgentOutcome["status"]]
  | { status: "lost"; costUsd: number }
  | { status: "timed-out"; costUsd: number };

// A tool result larger than this is kept in a file beside the log, and the event names it.
const inlineOutputLimit = 4000;

/**
 * Reads a session's messages until its outcome and records each as an event of the run:
 * records as they are, notes in the decision log, cost as what each tick added. A session that
 * outlives `maxMinutes` is stopped; one whose worker dies without an outcome is lost.
 */
export async function pumpSession(
  store: EventStore,
  session: LaunchedSession,
  envelope: Envelope,
  maxMinutes: number,
): Promise<SessionResult> {
  const files = runFiles(store.home, envelope.run_id);
  let costUsd = 0;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    session.stop();
  }, maxMinutes * 60_000);
  try {
    for await (const message of session.messages) {
      if ("note" in message) {
        await mkdir(files.dir, { recursive: true });
        await appendFile(files.decisions, `- ${message.note.replace(/\s+/g, " ")}\n`);
      } else if ("record" in message) {
        // Only the record types a worker may send, and only their type and data, become events.
        const record = {
          type: message.record.type,
          data: message.record.data,
        } as typeof message.record;
        if (!(recordTypes as readonly string[]).includes(record.type)) continue;
        if (record.type === "cost.tick") {
          const added = Math.max(0, record.data.usd - costUsd);
          costUsd = record.data.usd;
          await store.append({
            ...envelope,
            type: "cost.tick",
            data: record.data,
            cost: { usd: added, in: 0, out: 0, cache_read: 0 },
          });
        } else if (
          record.type === "tool.result" &&
          record.data.output !== undefined &&
          JSON.stringify(record.data.output).length > inlineOutputLimit
        ) {
          const name = `${record.data.call_id.replace(/[^A-Za-z0-9_-]/g, "_")}.json`;
          await mkdir(join(files.dir, "tool"), { recursive: true });
          await Bun.write(join(files.dir, "tool", name), JSON.stringify(record.data.output));
          await store.append({
            ...envelope,
            type: "tool.result",
            data: {
              call_id: record.data.call_id,
              is_error: record.data.is_error,
              output_path: `tool/${name}`,
            },
          });
        } else {
          await store.append({ ...envelope, ...record } as Parameters<EventStore["append"]>[0]);
        }
      } else {
        if (timedOut) return { status: "timed-out", costUsd };
        return {
          status: message.outcome.status,
          outcome: message.outcome,
        } as Ended[AgentOutcome["status"]];
      }
    }
  } finally {
    clearTimeout(timer);
  }
  if (timedOut) return { status: "timed-out", costUsd };
  return { status: "lost", costUsd };
}
