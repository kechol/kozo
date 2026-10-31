import { computed, signal } from "@preact/signals";
import {
  type Api,
  ApiError,
  type InboxRow,
  type ItemRow,
  type Status,
  type TaskRow,
} from "./api.ts";

export const status = signal<Status | null>(null);
export const inbox = signal<InboxRow[]>([]);
/** How many rows wait, which changes far less often than the rows a poll brings. */
export const waiting = computed(() => inbox.value.length);
export const items = signal<ItemRow[]>([]);
export const tasks = signal<TaskRow[]>([]);
/** Why the last refresh failed, such as kozod being down, or null. */
export const problem = signal<string | null>(null);
/** When the lists last refreshed, so a failure can say how old what the page shows is. */
export const refreshedAt = signal<Date | null>(null);
/** Whether kozod refused the tab's session, as after it starts again; the page then stops. */
export const sessionEnded = signal(false);
/** What an action answered, as the toast region shows it. */
export interface Toast {
  id: number;
  text: string;
  failed: boolean;
}

/**
 * The toasts shown now, oldest first, at most `toastLimit` of them; past it the oldest answer
 * goes first, and a failure only when nothing else is left.
 */
export const toasts = signal<Toast[]>([]);

export const toastLimit = 3;
/** How long an answer that succeeded stays; a failure stays until it is dismissed. */
const toastMs = 5000;
let lastToast = 0;

/** Shows an action's answer as a toast. */
export function notify(text: string, failed: boolean): number {
  const id = ++lastToast;
  const next = [...toasts.value, { id, text, failed }];
  while (next.length > toastLimit) {
    const oldest = next.findIndex((toast) => !toast.failed);
    next.splice(oldest === -1 ? 0 : oldest, 1);
  }
  toasts.value = next;
  if (!failed) setTimeout(() => dismiss(id), toastMs);
  return id;
}

export function dismiss(id: number): void {
  if (!toasts.value.some((toast) => toast.id === id)) return;
  toasts.value = toasts.value.filter((toast) => toast.id !== id);
}

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
    refreshedAt.value = new Date();
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) sessionEnded.value = true;
    problem.value = (error as Error).message;
  }
}

/**
 * Refreshes now and every `ms` milliseconds until the returned function is called; a refresh
 * waits for the one before it, and a hidden tab skips its turn.
 */
export function poll(api: Api, ms = 3000): () => void {
  let pending: Promise<void> | null = null;
  const turn = () => {
    if (pending || document.hidden || sessionEnded.value) return;
    pending = refresh(api).finally(() => {
      pending = null;
    });
  };
  turn();
  const timer = setInterval(turn, ms);
  return () => clearInterval(timer);
}

/** Runs one action, shows its answer and refreshes, so the page shows what it changed. */
export async function run(api: Api, action: () => Promise<{ message: string }>): Promise<boolean> {
  try {
    notify((await action()).message, false);
    return true;
  } catch (error) {
    notify((error as Error).message, true);
    return false;
  } finally {
    await refresh(api);
  }
}
