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
/** Whether the lists have loaded once, which changes once rather than on every refresh. */
export const loaded = computed(() => refreshedAt.value !== null);
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
 * other than the newest goes first, and a failure only when no such answer is left.
 */
export const toasts = signal<Toast[]>([]);

export const toastLimit = 3;
/** How long an answer that succeeded stays; a failure stays until it is dismissed. */
const toastMs = 5000;
let lastToast = 0;
/** The answers' timers; none run while the human points at or focuses the toasts. */
const timers = new Map<number, ReturnType<typeof setTimeout>>();
let held = false;

function expire(id: number): void {
  timers.set(
    id,
    setTimeout(() => dismiss(id), toastMs),
  );
}

/** Shows an action's answer as a toast. */
export function notify(text: string, failed: boolean): number {
  const id = ++lastToast;
  const next = [...toasts.value, { id, text, failed }];
  while (next.length > toastLimit) {
    const oldest = next.findIndex((toast, index) => !toast.failed && index < next.length - 1);
    const [gone] = next.splice(oldest === -1 ? 0 : oldest, 1);
    if (gone) clearTimeout(timers.get(gone.id));
  }
  toasts.value = next;
  if (!failed && !held) expire(id);
  return id;
}

export function dismiss(id: number): void {
  clearTimeout(timers.get(id));
  timers.delete(id);
  if (!toasts.value.some((toast) => toast.id === id)) return;
  toasts.value = toasts.value.filter((toast) => toast.id !== id);
}

/**
 * Stops the answers from going while the human reads them, and lets each run its full time again
 * once they stop.
 */
export function holdToasts(hold: boolean): void {
  if (hold === held) return;
  held = hold;
  for (const toast of toasts.value) {
    if (toast.failed) continue;
    clearTimeout(timers.get(toast.id));
    timers.delete(toast.id);
    if (!hold) expire(toast.id);
  }
}

let lastRefresh = 0;

/**
 * Reads the status and every list once; a failure keeps the last good values, and an answer that
 * arrives after a later refresh started is dropped, since it may be older than what that one shows.
 */
export async function refresh(api: Api): Promise<void> {
  const mine = ++lastRefresh;
  try {
    const [nextStatus, nextInbox, nextItems, nextTasks] = await Promise.all([
      api.get<Status>("/api/status"),
      api.get<InboxRow[]>("/api/ls/inbox"),
      api.get<ItemRow[]>("/api/ls/items"),
      api.get<TaskRow[]>("/api/ls/tasks"),
    ]);
    if (mine !== lastRefresh) return;
    status.value = nextStatus;
    inbox.value = nextInbox;
    items.value = nextItems;
    tasks.value = nextTasks;
    problem.value = null;
    refreshedAt.value = new Date();
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) sessionEnded.value = true;
    if (mine === lastRefresh) problem.value = (error as Error).message;
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

/**
 * Runs one action, shows its answer and refreshes, so the page shows what it changed. A failure
 * goes to `failed` when the action has a place of its own to say it, and to a toast otherwise.
 */
export async function run(
  api: Api,
  action: () => Promise<{ message: string }>,
  failed?: (message: string) => void,
): Promise<boolean> {
  try {
    notify((await action()).message, false);
    return true;
  } catch (error) {
    const message = (error as Error).message;
    if (failed) failed(message);
    else notify(message, true);
    return false;
  } finally {
    await refresh(api);
  }
}
