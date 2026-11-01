import type {
  ApprovalKind,
  BlockedReason,
  FactoryState,
  HoldKind,
  ItemState,
  Message,
  NoteKind,
  Stage,
  TaskState,
} from "@kozo/core";
import type { EventStore } from "./event-store.ts";

/** An item, or one of its tasks. */
export interface Subject {
  item: string;
  task: string | null;
}

type Actor = "human" | "kozod";

// The longest reason an event keeps, the length the event schema allows.
const cut = (reason: string) => reason.slice(0, 2000);

const cutValues = ({ code, values }: Message): Message => ({
  code,
  values: Object.fromEntries(
    Object.entries(values).map(([name, value]) => [
      name,
      typeof value === "string" ? cut(value) : value,
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

/**
 * Moves the subject to `to` unless it is there already, or, when `from` is given, unless it has
 * left `from` since the caller looked; resolves to whether it did.
 */
export async function move(
  store: EventStore,
  subject: Subject,
  to: Stage,
  reason: string,
  { by = "kozod", run, from }: { by?: Actor; run?: string; from?: Stage } = {},
): Promise<boolean> {
  const event = await store.appendIf((state) => {
    const current = stateOf(state, subject);
    if (!current || current.stage === to) return null;
    if (from !== undefined && current.stage !== from) return null;
    return {
      type: "stage.changed",
      item: subject.item,
      task: subject.task,
      ...(run ? { run_id: run } : {}),
      data: { target: targetOf(subject), from: current.stage, to, by, reason: cut(reason) },
    };
  });
  return event !== null;
}

/** Keeps a note about the subject for the runs that follow. */
export async function note(
  store: EventStore,
  subject: Subject,
  kind: NoteKind,
  text: string,
): Promise<void> {
  await store.append({
    type: "note.added",
    item: subject.item,
    task: subject.task,
    data: { kind, text },
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
