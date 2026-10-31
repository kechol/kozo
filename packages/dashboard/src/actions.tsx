import type { Verb } from "@kozo/core";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "preact/hooks";
import type { Api } from "./api.ts";
import { Modal } from "./dialog.tsx";
import { run } from "./store.ts";

/** One verb on a reference, as the inbox and the detail view offer it. */
export interface Action {
  verb: Verb;
  label: string;
  /** The body without the human's text. */
  body?: Record<string, unknown>;
  /** The field the human's text fills, and whether the verb needs it. */
  text?: { field: string; required: boolean; placeholder: string };
  /**
   * How much the button stands out among its row's: the one verb that settles what waits is
   * primary, a verb seldom wanted is ghost, one that cannot be undone, such as cancelling, is
   * danger, and the others are secondary.
   */
  emphasis?: "primary" | "ghost" | "danger";
  /** For a verb that closes work, which first asks in an alert dialog: its question and what it ends. */
  confirm?: { ask: (ref: string) => string; ends: string };
}

/** Cancelling an item or a task, which asks why. */
export const cancelAction: Action = {
  verb: "close",
  label: "Cancel",
  text: { field: "cancel", required: true, placeholder: "Why it is cancelled" },
  emphasis: "danger",
  confirm: {
    ask: (ref) => `Cancel ${ref}?`,
    ends: "Its runs stop, and its worktrees and task branches are removed. It closes as Cancelled and stays closed.",
  },
};

const doneAction: Action = {
  verb: "close",
  label: "Close as done",
  body: { done: true },
  emphasis: "ghost",
  confirm: {
    ask: (ref) => `Close ${ref} as done?`,
    ends: "Its runs stop and its worktrees are removed. It closes as Complete and stays closed.",
  },
};

export const retryAction: Action = {
  verb: "retry",
  label: "Retry",
  text: { field: "text", required: false, placeholder: "What to do differently" },
};

export const takeAction: Action = { verb: "take", label: "Take it over" };

/** A sending button stays focusable, so it is marked busy rather than disabled. */
export const busyAttributes = (busy: boolean) =>
  busy ? ({ "aria-busy": true, "aria-disabled": true } as const) : {};

/**
 * The key of an action among its row's. A verb's label changes with what waits, as Send becomes
 * Answer, and a new key would drop what was typed; only the verbs that close work share a verb.
 */
export const actionKey = (action: Action) => (action.confirm ? action.label : action.verb);

/**
 * The verbs a row of the inbox offers for what it waits on. There is never a merge, and each
 * action acts on one reference only.
 */
export function inboxActions(
  kind: "item" | "task",
  waiting: string,
  approval: "start" | "plan" | null,
): Action[] {
  switch (waiting) {
    case "approval":
      return approval === "plan"
        ? [
            {
              verb: "approve",
              label: "Approve plan",
              emphasis: "primary",
              text: {
                field: "text",
                required: false,
                placeholder: "Anything the runs should know",
              },
            },
            {
              verb: "reject",
              label: "Reject plan",
              text: { field: "reason", required: true, placeholder: "What the plan should change" },
            },
          ]
        : [
            {
              verb: "approve",
              label: "Approve start",
              emphasis: "primary",
              text: { field: "text", required: false, placeholder: "Anything triage should know" },
            },
            cancelAction,
          ];
    case "question":
      return [
        {
          verb: "say",
          label: "Answer",
          emphasis: "primary",
          text: { field: "text", required: true, placeholder: "Your answer" },
        },
        ...(kind === "task" ? [takeAction] : []),
      ];
    case "attention":
      return [
        { ...retryAction, emphasis: "primary" },
        ...(kind === "task" ? [takeAction] : []),
        doneAction,
        cancelAction,
      ];
    default:
      return [];
  }
}

/**
 * A button for an action. One that takes text opens a field for it in place, and one that closes
 * work asks in an alert dialog first; either gives focus back to the button when it closes.
 */
export function ActionButton({
  api,
  refName,
  action,
}: {
  api: Api;
  refName: string;
  action: Action;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const restore = useRef(false);
  const id = useId();

  useEffect(() => {
    if (open) {
      field.current?.focus();
    } else if (restore.current) {
      restore.current = false;
      trigger.current?.focus();
    }
  }, [open]);

  // A sent action often settles what the button's row waits on, so the row goes; focus then
  // moves to the next row's first verb, as a worklist goes on to what is next, or to the view
  // when no row is left. A layout cleanup runs while the row is still in the page, and an open
  // modal dialog makes the view inert, so it closes first.
  useLayoutEffect(
    () => () => {
      const holder = [trigger.current, form.current].find((node) =>
        node?.contains(document.activeElement),
      );
      if (!holder) return;
      holder.closest("dialog")?.close();
      const row = holder.closest("li");
      const next = row?.nextElementSibling ?? row?.previousElementSibling;
      const verb = next?.querySelector<HTMLElement>(".actions button, .actions a");
      (verb ?? holder.closest("main"))?.focus();
    },
    [],
  );

  const close = () => {
    if (busy) return;
    restore.current = true;
    setFailure(null);
    setOpen(false);
  };
  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setFailure(null);
    const words = text.trim();
    const body = {
      ...action.body,
      ...(action.text && words ? { [action.text.field]: words } : {}),
    };
    // A verb with a field says its failure in the field, where a dialog cannot hide it.
    const opened = Boolean(action.text || action.confirm);
    const done = await run(
      api,
      () => api.act(refName, action.verb, body),
      opened ? setFailure : undefined,
    );
    setBusy(false);
    if (done) {
      setText("");
      restore.current = true;
      setOpen(false);
    }
  };
  // Inside its field, the verb is what the field is for, so it takes the strongest style.
  const sendStyle = action.emphasis === "danger" || action.confirm ? "danger-solid" : "primary";
  const sending = busyAttributes(busy);
  const label = busy ? "Sending…" : action.label;

  if (!action.text && !action.confirm) {
    return (
      <button type="button" ref={trigger} class={action.emphasis} onClick={submit} {...sending}>
        {label}
      </button>
    );
  }
  const missing = action.text?.required === true && text.trim() === "";
  const sendButton = (
    <button
      type="submit"
      class={sendStyle}
      disabled={missing}
      aria-keyshortcuts={action.text ? "Meta+Enter Control+Enter" : undefined}
      {...sending}
    >
      {label}
    </button>
  );
  // An alert dialog puts the way back first, so the verb that closes work is the last stop.
  const backButton = (
    <button type="button" class="ghost" onClick={close} disabled={busy}>
      Back
    </button>
  );
  const fields = (
    <form
      ref={form}
      class="action-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!missing) void submit();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        close();
      }}
    >
      {action.confirm ? (
        <>
          <h2 id={`${id}-title`}>{action.confirm.ask(refName)}</h2>
          <p id={`${id}-body`}>{action.confirm.ends}</p>
        </>
      ) : null}
      {action.text ? (
        <textarea
          ref={field}
          aria-label={`${action.label}: ${action.text.placeholder}`}
          placeholder={action.text.placeholder}
          value={text}
          rows={3}
          onInput={(event) => setText((event.target as HTMLTextAreaElement).value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey)) return;
            event.preventDefault();
            form.current?.requestSubmit();
          }}
        />
      ) : null}
      {failure ? (
        <div class="problem" role="alert">
          {failure}
        </div>
      ) : null}
      <div class="row form-actions">
        {action.confirm ? (
          <>
            {backButton}
            {sendButton}
          </>
        ) : (
          <>
            {sendButton}
            {backButton}
          </>
        )}
      </div>
    </form>
  );
  const opener = (
    <button type="button" ref={trigger} class={action.emphasis} onClick={() => setOpen(true)}>
      {action.label}…
    </button>
  );
  if (action.confirm) {
    return (
      <>
        {opener}
        {open ? (
          <Modal alert label={`${id}-title`} description={`${id}-body`} onClose={close}>
            {fields}
          </Modal>
        ) : null}
      </>
    );
  }
  return open ? fields : opener;
}
