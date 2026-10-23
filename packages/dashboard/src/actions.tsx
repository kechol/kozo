import type { Verb } from "@kozo/core";
import { useState } from "preact/hooks";
import type { Api } from "./api.ts";
import { run } from "./store.ts";

/** One verb on a reference, as the inbox and the detail view offer it. */
export interface Action {
  verb: Verb;
  label: string;
  /** The body without the human's text. */
  body?: Record<string, unknown>;
  /** The field the human's text fills, and whether the verb needs it. */
  text?: { field: string; required: boolean; placeholder: string };
  /** A verb that cannot be undone, such as cancelling, styled as such. */
  danger?: boolean;
}

/**
 * The verbs a row of the inbox offers for what it waits on. There is never a merge, and each
 * action acts on one reference only.
 */
export function inboxActions(
  kind: "item" | "task",
  waiting: string,
  reason: string | null,
): Action[] {
  const cancel: Action = {
    verb: "close",
    label: "Cancel",
    text: { field: "cancel", required: true, placeholder: "Why it is cancelled" },
    danger: true,
  };
  switch (waiting) {
    case "approval":
      return reason === "plan approval"
        ? [
            {
              verb: "approve",
              label: "Approve plan",
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
              text: { field: "text", required: false, placeholder: "Anything triage should know" },
            },
            cancel,
          ];
    case "question":
      return [
        {
          verb: "say",
          label: "Answer",
          text: { field: "text", required: true, placeholder: "Your answer" },
        },
        ...(kind === "task" ? [{ verb: "take", label: "Take it over" } as Action] : []),
      ];
    case "attention":
      return [
        {
          verb: "retry",
          label: "Retry",
          text: { field: "text", required: false, placeholder: "What to do differently" },
        },
        ...(kind === "task" ? [{ verb: "take", label: "Take it over" } as Action] : []),
        { verb: "close", label: "Close as done", body: { done: true } },
        cancel,
      ];
    default:
      return [];
  }
}

/** A button for an action; one that takes text opens a field for it first. */
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
  const submit = async () => {
    setBusy(true);
    const words = text.trim();
    const body = {
      ...action.body,
      ...(action.text && words ? { [action.text.field]: words } : {}),
    };
    const done = await run(api, () => api.act(refName, action.verb, body));
    setBusy(false);
    if (done) {
      setOpen(false);
      setText("");
    }
  };
  const kind = action.danger ? "danger" : "";
  if (!action.text) {
    return (
      <button type="button" class={kind} disabled={busy} onClick={submit}>
        {action.label}
      </button>
    );
  }
  if (!open) {
    return (
      <button type="button" class={kind} onClick={() => setOpen(true)}>
        {action.label}…
      </button>
    );
  }
  const missing = action.text.required && text.trim() === "";
  return (
    <form
      class="action-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!missing) void submit();
      }}
    >
      <textarea
        aria-label={`${action.label}: ${action.text.placeholder}`}
        placeholder={action.text.placeholder}
        value={text}
        rows={3}
        onInput={(event) => setText((event.target as HTMLTextAreaElement).value)}
      />
      <div class="row">
        <button type="submit" class={kind} disabled={busy || missing}>
          {action.label}
        </button>
        <button type="button" class="quiet" onClick={() => setOpen(false)}>
          Back
        </button>
      </div>
    </form>
  );
}
