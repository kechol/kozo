import { ActionButton, inboxActions } from "./actions.tsx";
import type { Api, InboxRow } from "./api.ts";
import { Badge } from "./badge.tsx";
import { ago, detailHash } from "./format.ts";
import { Icon, type IconName } from "./icons.tsx";
import { inbox } from "./store.ts";
import { toneOf } from "./tone.ts";

const label: Record<InboxRow["waiting"], string> = {
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

/** The exact time a row began waiting, shown on hover; one formatter serves every row. */
const exact = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

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
              {row.approval === "plan"
                ? "Plan approval"
                : row.approval === "start"
                  ? "Start approval"
                  : label[row.waiting]}
            </Badge>
            <h2 class="row-heading">
              <a href={detailHash(row.ref)} class="row-title">
                {row.title}
              </a>
            </h2>
            <span class="ref">{row.ref}</span>
            <time dateTime={row.since} title={exact.format(new Date(row.since))}>
              {ago(row.since)}
            </time>
          </div>
          {row.reason && row.waiting !== "approval" ? <p class="reason">{row.reason}</p> : null}
          {row.waiting === "merge" ? (
            <p class="reason">
              Read the diff and merge the task branch yourself; kozo never merges.
            </p>
          ) : null}
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
