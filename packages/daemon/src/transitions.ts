import {
  type ApprovalKind,
  type BlockedReason,
  type FactoryState,
  type HoldKind,
  type ItemState,
  isClosed,
  type Message,
  type NoteKind,
  type Stage,
  type TaskState,
} from "@kozo/core";
import type { EventStore, NewEvent } from "./event-store.ts";

/** An item, or one of its tasks. */
export interface Subject {
  item: string;
  task: string | null;
}

type Actor = "human" | "kozod";

// The longest reason an event keeps, the length the event schema allows.
const cut = (reason: string) => reason.slice(0, 2000);

/** `message` with each text in it kept to the length an event holds. */
export const cutValues = ({ code, values }: Message): Message => ({
  code,
  values: Object.fromEntries(
    Object.entries(values).map(([name, value]) => [
      name,
      typeof value === "string"
        ? cut(value)
        : Array.isArray(value)
          ? value.map(cutValues)
          : typeof value === "object"
            ? cutValues(value)
            : value,
    ]),
  ),
});

const stateOf = (state: Readonly<FactoryState>, { item, task }: Subject) =>
  (task === null ? state.items[item] : state.tasks[task]) as ItemState | TaskState | undefined;

const targetOf = ({ task }: Subject) => (task === null ? "item" : "task");

const runEnvelope = (state: Readonly<FactoryState>, run: string | undefined) =>
  run ? { run_id: run, parent_run: state.runs[run]?.parent ?? null } : {};

/*
 * The state transitions the daemon makes: holds and their clearing, stage moves, notes and the
 * writes kozod makes outside itself. Each looks at the state and appends inside the store's
 * queue, so that no other event comes between the look and the append, and each does nothing
 * when the subject is gone or already as asked.
 */

/**
 * Holds the subject unless it is held already; resolves to whether it did. An approval hold
 * says which approval it waits for.
 */
export async function hold(
  store: EventStore,
  subject: Subject,
  hold: HoldKind,
  reason: Message,
  {
    by = "kozod",
    run,
    blocked,
    approval,
  }: { by?: Actor; run?: string; blocked?: BlockedReason; approval?: ApprovalKind } = {},
): Promise<boolean> {
  const event = await store.appendIf((state) => {
    const current = stateOf(state, subject);
    if (!current || current.hold) return null;
    return {
      type: "hold.set",
      item: subject.item,
      task: subject.task,
      ...runEnvelope(state, run),
      data: {
        target: targetOf(subject),
        hold,
        by,
        reason: cutValues(reason),
        ...(blocked ? { blocked } : {}),
        ...(approval ? { approval } : {}),
      },
    };
  });
  return event !== null;
}

/** Clears the subject's hold, only one of `kind` when it is given; resolves to whether it did. */
export async function clearHold(
  store: EventStore,
  subject: Subject,
  { by = "kozod", kind, reason }: { by?: Actor; kind?: HoldKind; reason?: Message } = {},
): Promise<boolean> {
  const event = await store.appendIf((state) => {
    const current = stateOf(state, subject);
    if (!current?.hold || (kind !== undefined && current.hold.kind !== kind)) return null;
    return {
      type: "hold.cleared",
      item: subject.item,
      task: subject.task,
      data: {
        target: targetOf(subject),
        hold: current.hold.kind,
        by,
        ...(reason ? { reason: cutValues(reason) } : {}),
      },
    };
  });
  return event !== null;
}

/** A step that releaseHold appends after the hold it clears. */
export type AfterHold =
  | { move: Stage; reason: Message }
  | { hold: HoldKind; reason: Message; by?: Actor }
  | { note: NoteKind; text: Message }
  | { event: NewEvent };

/**
 * Clears the subject's hold, when it has one, and appends the steps `after` makes of the
 * subject in the same turn of the store's queue, so that nothing, the scheduler included, sees
 * the subject without a hold in between; a move to the stage the subject is in is left out.
 * Nothing happens when the subject is gone, or, with `kind`, when its hold is not of that kind;
 * resolves to whether anything was appended.
 */
export async function releaseHold(
  store: EventStore,
  subject: Subject,
  after: (current: ItemState | TaskState) => AfterHold[],
  { by = "kozod", reason, kind }: { by?: Actor; reason?: Message; kind?: HoldKind } = {},
): Promise<boolean> {
  const written = await store.appendAllIf((state) => {
    const current = stateOf(state, subject);
    if (!current) return null;
    // A verb that clears one kind of hold does nothing once that hold is gone, as when the same
    // approval arrives twice.
    if (kind !== undefined && current.hold?.kind !== kind) return null;
    const target = targetOf(subject);
    const events: NewEvent[] = [];
    if (current.hold)
      events.push({
        type: "hold.cleared",
        item: subject.item,
        task: subject.task,
        data: {
          target,
          hold: current.hold.kind,
          by,
          ...(reason ? { reason: cutValues(reason) } : {}),
        },
      });
    for (const step of after(current)) {
      if ("move" in step) {
        if (step.move !== current.stage)
          events.push(stageChanged(subject, current.stage, step.move, step.reason, by));
      } else if ("hold" in step) {
        events.push({
          type: "hold.set",
          item: subject.item,
          task: subject.task,
          data: { target, hold: step.hold, by: step.by ?? by, reason: cutValues(step.reason) },
        });
      } else if ("note" in step) {
        events.push({
          type: "note.added",
          item: subject.item,
          task: subject.task,
          data: { kind: step.note, text: cutValues(step.text) },
        });
      } else events.push(step.event);
    }
    return events;
  });
  return written.length > 0;
}

/**
 * Moves the subject to `to` unless it is there already, or, when `from` is given, unless it has
 * left `from` since the caller looked; resolves to whether it did.
 */
export async function move(
  store: EventStore,
  subject: Subject,
  to: Stage,
  reason: Message,
  { by = "kozod", run, from }: { by?: Actor; run?: string; from?: Stage } = {},
): Promise<boolean> {
  const event = await store.appendIf((state) => {
    const current = stateOf(state, subject);
    if (!current || current.stage === to) return null;
    if (from !== undefined && current.stage !== from) return null;
    return stageChanged(subject, current.stage, to, reason, by, run);
  });
  return event !== null;
}

const stageChanged = (
  subject: Subject,
  from: Stage,
  to: Stage,
  reason: Message,
  by: Actor = "kozod",
  run?: string,
): NewEvent => ({
  type: "stage.changed",
  item: subject.item,
  task: subject.task,
  ...(run ? { run_id: run } : {}),
  data: { target: targetOf(subject), from, to, by, reason: cutValues(reason) },
});

/**
 * Completes a merged task in Handoff and, once no other task of its item is open, moves the item
 * on with it: back to Triage with the defect when `defect` is given, else to Complete. Every
 * event goes in one turn of the store's queue, so no hold can come between the task and its
 * item. Nothing happens while the task or its item is held; resolves to whether it completed.
 */
export async function completeMerged(
  store: EventStore,
  subject: { item: string; task: string },
  reason: Message,
  last: {
    complete: Message;
    defect: { reason: Message; note: Message; back: Message } | null;
  },
): Promise<boolean> {
  const written = await store.appendAllIf((state) => {
    const task = state.tasks[subject.task];
    const item = state.items[subject.item];
    if (!task || !item || task.stage !== "handoff" || task.hold || item.hold) return null;
    const events = [stageChanged(subject, task.stage, "complete", reason)];
    const others = item.tasks.filter((ref) => ref !== subject.task);
    if (
      isClosed(item.stage) ||
      others.some((ref) => !isClosed(state.tasks[ref]?.stage ?? "cancelled"))
    )
      return events;
    const { defect } = last;
    const owner = { item: subject.item, task: null };
    if (defect === null)
      return [...events, stageChanged(owner, item.stage, "complete", last.complete)];
    return [
      ...events,
      // A defect sends the item straight back to Triage, so it never looks complete in between.
      { type: "note.added", ...subject, data: { kind: "check", text: cutValues(defect.note) } },
      { type: "task.defect", ...subject, data: { reason: cutValues(defect.reason) } },
      stageChanged(owner, item.stage, "triage", defect.back),
    ];
  });
  return written.length > 0;
}

/**
 * Cancels the given tasks, which a split of their item replaces, and sends the item from
 * Building back to Planning with its current plan as the draft, in one turn of the store's
 * queue. Nothing happens while the item is held, since a held item cannot change stage; the
 * split then waits for the hold, and the stopped task tries again once it clears. Resolves to
 * the tasks it cancelled.
 */
export async function splitTasks(
  store: EventStore,
  itemRef: string,
  tasks: readonly string[],
  reason: Message,
): Promise<string[]> {
  const written = await store.appendAllIf((state) => {
    const item = state.items[itemRef];
    if (!item?.plan || item.hold) return null;
    const events: NewEvent[] = [];
    for (const ref of tasks) {
      const task = state.tasks[ref];
      if (!task || isClosed(task.stage)) continue;
      const subject = { item: itemRef, task: ref };
      if (task.hold)
        events.push({
          type: "hold.cleared",
          ...subject,
          data: { target: "task", hold: task.hold.kind, by: "kozod" },
        });
      events.push(stageChanged(subject, task.stage, "cancelled", reason));
    }
    // A second block while the item is already back in Planning only cancels its own tasks;
    // the plan agent sees them among the tasks so far.
    if (item.stage !== "building") return events;
    return [
      ...events,
      { type: "plan.proposed", item: itemRef, data: { plan: item.plan } },
      stageChanged({ item: itemRef, task: null }, "building", "planning", reason),
    ];
  });
  return written.flatMap((event) =>
    event.type === "stage.changed" && event.task !== null ? [event.task] : [],
  );
}

/** Keeps a note about the subject for the runs that follow. */
export async function note(
  store: EventStore,
  subject: Subject,
  kind: NoteKind,
  text: Message,
): Promise<void> {
  await store.append({
    type: "note.added",
    item: subject.item,
    task: subject.task,
    data: { kind, text: cutValues(text) },
  });
}

/** Records a write kozod made outside itself, such as a push or a comment on an Issue. */
export async function externalWrite(
  store: EventStore,
  subject: Subject,
  target: "github" | "local",
  action: string,
  what: string,
  run?: string,
): Promise<void> {
  await store.append({
    type: "external.write",
    item: subject.item,
    task: subject.task,
    ...(run ? { run_id: run } : {}),
    data: { target, action, subject: what },
  });
}
