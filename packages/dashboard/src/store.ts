import { signal } from "@preact/signals";
import type { Api, InboxRow, ItemRow, Status, TaskRow } from "./api.ts";

export const status = signal<Status | null>(null);
export const inbox = signal<InboxRow[]>([]);
export const items = signal<ItemRow[]>([]);
export const tasks = signal<TaskRow[]>([]);
/** Why the last refresh failed, such as kozod being down, or null. */
export const problem = signal<string | null>(null);
/** What the last action answered, shown until the next one. */
export const notice = signal<{ text: string; failed: boolean } | null>(null);

/** Reads the status and every list once; a failure keeps the last good values. */
export async function refresh(api: Api): Promise<void> {
  try {
    const [nextStatus, nextInbox, nextItems, nextTasks] = await Promise.all([
      api.get<Status>("/api/status"),
      api.get<InboxRow[]>("/api/ls/inbox"),
      api.get<ItemRow[]>("/api/ls/items"),
      api.get<TaskRow[]>("/api/ls/tasks"),
    ]);
    status.value = nextStatus;
    inbox.value = nextInbox;
    items.value = nextItems;
    tasks.value = nextTasks;
    problem.value = null;
  } catch (error) {
    problem.value = (error as Error).message;
  }
}

/** Refreshes now and every `ms` milliseconds until the returned function is called. */
export function poll(api: Api, ms = 3000): () => void {
  void refresh(api);
  const timer = setInterval(() => void refresh(api), ms);
  return () => clearInterval(timer);
}

/** Runs one action, shows its answer and refreshes, so the page shows what it changed. */
export async function run(api: Api, action: () => Promise<{ message: string }>): Promise<boolean> {
  try {
    notice.value = { text: (await action()).message, failed: false };
    return true;
  } catch (error) {
    notice.value = { text: (error as Error).message, failed: true };
    return false;
  } finally {
    await refresh(api);
  }
}
