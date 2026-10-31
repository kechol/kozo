import { ActionButton, inboxActions } from "./actions.tsx";
import type { Api, InboxRow } from "./api.ts";
import { Badge } from "./badge.tsx";
import { detailHash } from "./format.ts";
import { Icon, type IconName } from "./icons.tsx";
import { inbox } from "./store.ts";
import { Time } from "./time.tsx";
import { toneOf } from "./tone.ts";

/** What a row waits on, by its approval kind for an approval and by its waiting kind otherwise. */
const label: Record<NonNullable<InboxRow["approval"]> | InboxRow["waiting"], string> = {
  start: "Start approval",
  plan: "Plan approval",
  approval: "Approval",
  question: "Question",
  attention: "Attention",
  merge: "Ready to merge",
};

/** Glyphs closer to what a row waits on than its tone's own. */
const glyph: Partial<Record<InboxRow["waiting"], IconName>> = {
  question: "question",
  merge: "pull-request",
};

/** The line under a row's title; an approval's reason only repeats its badge. */
function Note({ row }: { row: InboxRow }) {
  if (row.waiting === "approval") return null;
  const text =
    row.waiting === "merge"
      ? "Read the diff and merge the task branch yourself; kozo never merges."
      : row.reason;
  return text ? <p class="reason">{text}</p> : null;
}

/** What waits for the human, oldest first, each with the verbs that settle it. */
export function Inbox({ api }: { api: Api }) {
  const rows = inbox.value;
  if (rows.length === 0) {
    return (
      <div class="panel empty-state">
        <Icon name="check" />
        <p>
          <strong>Nothing waits for you.</strong> kozo asks here when it needs an approval, an
          answer or your attention, and when a branch is ready to merge.
        </p>
      </div>
    );
  }
  return (
    <ul class="panel rows">
      {rows.map((row) => (
        <li key={`${row.ref} ${row.waiting}`} class="inbox-row">
          <div class="row-head">
            <Badge tone={toneOf("waiting", row.waiting)} icon={glyph[row.waiting]}>
              {label[row.approval ?? row.waiting]}
            </Badge>
            <h2 class="row-heading">
              <a href={detailHash(row.ref)} class="row-title">
                {row.title}
              </a>
            </h2>
            <span class="ref">{row.ref}</span>
            <Time iso={row.since} />
          </div>
          <Note row={row} />
          <div class="row actions">
            {inboxActions(row.kind, row.waiting, row.approval).map((action) => (
              <ActionButton key={action.label} api={api} refName={row.ref} action={action} />
            ))}
            {row.waiting === "merge" ? (
              <a class="button-link" href={detailHash(row.ref)}>
                Read the diff
              </a>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}
