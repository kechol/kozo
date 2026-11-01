import type { Verb } from "@kozo/core";
import type { ComponentChildren } from "preact";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "preact/hooks";
import type { Api } from "./api.ts";
import { Modal } from "./dialog.tsx";
import { run } from "./store.ts";
import { t } from "./words.ts";

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

// The actions are built while rendering, so that their words are in the locale of the moment.

/** Cancelling an item or a task, which asks why. */
export const cancelAction = (): Action => ({
  verb: "close",
  label: t("action.cancel"),
  text: { field: "cancel", required: true, placeholder: t("action.cancelHint") },
  emphasis: "danger",
  confirm: {
    ask: (ref) => t("action.cancelAsk", { ref }),
    ends: t("action.cancelEnds"),
  },
});

const doneAction = (): Action => ({
  verb: "close",
  label: t("action.done"),
  body: { done: true },
  emphasis: "ghost",
  confirm: {
    ask: (ref) => t("action.doneAsk", { ref }),
    ends: t("action.doneEnds"),
  },
});

export const retryAction = (): Action => ({
  verb: "retry",
  label: t("action.retry"),
  text: { field: "text", required: false, placeholder: t("action.retryHint") },
});

export const takeAction = (): Action => ({ verb: "take", label: t("action.take") });

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
              label: t("action.approvePlan"),
              emphasis: "primary",
              text: {
                field: "text",
                required: false,
                placeholder: t("action.approvePlanHint"),
              },
            },
            {
              verb: "reject",
              label: t("action.rejectPlan"),
              text: {
                field: "reason",
                required: true,
                placeholder: t("action.rejectPlanHint"),
              },
            },
          ]
        : [
            {
              verb: "approve",
              label: t("action.approveStart"),
              emphasis: "primary",
              text: { field: "text", required: false, placeholder: t("action.approveStartHint") },
            },
            cancelAction(),
          ];
    case "question":
      return [
        {
          verb: "say",
          label: t("action.answer"),
          emphasis: "primary",
          text: { field: "text", required: true, placeholder: t("action.answerHint") },
        },
        ...(kind === "task" ? [takeAction()] : []),
      ];
    case "attention":
      return [
        { ...retryAction(), emphasis: "primary" },
        ...(kind === "task" ? [takeAction()] : []),
        doneAction(),
        cancelAction(),
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
  const label = busy ? t("action.sending") : action.label;

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
      {t("action.back")}
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
      {action.label}
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

/** What the human typed for a reference and has not sent, kept while the pane shows others. */
const drafts = new Map<string, string>();

/**
 * The verbs of a reference, laid out open: the verbs that take text share one field, which is
 * there from the start, and send it with their buttons; a verb that needs text waits for some,
 * and Cmd+Enter or Ctrl+Enter sends the first. The verbs that take no text sit beside them, and
 * `more` holds the seldom ones. When `focus` is set the field takes focus as it appears.
 */
export function Composer({
  api,
  refName,
  actions,
  more,
  focus = false,
}: {
  api: Api;
  refName: string;
  actions: Action[];
  more?: ComponentChildren;
  focus?: boolean;
}) {
  const [text, setText] = useState(drafts.get(refName) ?? "");
  const [busy, setBusy] = useState<Action | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const writing = actions.filter((action) => action.text);
  const plain = actions.filter((action) => !action.text);
  const words = text.trim();
  // One field serves several verbs, so it says what each takes, and which take it at will.
  const hint =
    writing.length === 1
      ? writing[0]?.text?.placeholder
      : writing
          .map((action) =>
            t("composer.line", {
              verb: action.label,
              hint: action.text?.required
                ? (action.text.placeholder ?? "")
                : t("composer.optional", { hint: action.text?.placeholder ?? "" }),
            }),
          )
          .join("\n");

  // Only as it appears: a later render must not pull focus from wherever the human moved it.
  const focusFirst = useRef(focus);
  useEffect(() => {
    if (focusFirst.current) field.current?.focus();
  }, []);

  const write = (next: string) => {
    setText(next);
    if (next === "") drafts.delete(refName);
    else drafts.set(refName, next);
  };
  const send = async (action: Action) => {
    if (busy || (action.text?.required && words === "")) return;
    setBusy(action);
    setFailure(null);
    const body = {
      ...action.body,
      ...(action.text && words ? { [action.text.field]: words } : {}),
    };
    const done = await run(
      api,
      () => api.act(refName, action.verb, body),
      action.text ? setFailure : undefined,
    );
    setBusy(null);
    if (done && action.text) write("");
  };
  const button = (action: Action) => (
    <button
      key={actionKey(action)}
      type="button"
      class={action.emphasis}
      disabled={action.text?.required === true && words === ""}
      aria-keyshortcuts={action === writing[0] ? "Meta+Enter Control+Enter" : undefined}
      onClick={() => void send(action)}
      {...busyAttributes(busy === action)}
    >
      {busy === action ? t("action.sending") : action.label}
    </button>
  );
  return (
    <div class="composer">
      {writing.length > 0 ? (
        <textarea
          ref={field}
          aria-label={hint}
          placeholder={hint}
          value={text}
          rows={3}
          onInput={(event) => write((event.target as HTMLTextAreaElement).value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey)) return;
            event.preventDefault();
            if (writing[0]) void send(writing[0]);
          }}
        />
      ) : null}
      {failure ? (
        <div class="problem" role="alert">
          {failure}
        </div>
      ) : null}
      <div class="row actions">
        {writing.map(button)}
        {plain.map(button)}
        {more}
      </div>
    </div>
  );
}
