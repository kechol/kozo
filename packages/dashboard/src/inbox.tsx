import { ActionButton, inboxActions } from "./actions.tsx";
import type { Api } from "./api.ts";
import { ago, detailHash } from "./format.ts";
import { inbox } from "./store.ts";

const label: Record<string, string> = {
  approval: "approval",
  question: "question",
  attention: "attention",
  merge: "ready to merge",
};

/** What waits for the human, oldest first, each with the verbs that settle it. */
export function Inbox({ api }: { api: Api }) {
  const rows = inbox.value;
  if (rows.length === 0) {
    return <p class="empty">Nothing waits for you.</p>;
  }
  return (
    <ul class="inbox">
      {rows.map((row) => (
        <li key={`${row.ref} ${row.waiting}`} class={`card waiting-${row.waiting}`}>
          <div class="row spread">
            <a href={detailHash(row.ref)} class="ref">
              {row.ref}
            </a>
            <span class={`badge ${row.waiting}`}>{label[row.waiting] ?? row.waiting}</span>
          </div>
          <h3>{row.title}</h3>
          {row.reason ? <p class="reason">{row.reason}</p> : null}
          {row.waiting === "merge" ? (
            <p class="hint">Read the diff and merge the task branch yourself; kozo never merges.</p>
          ) : null}
          <div class="row actions">
            {inboxActions(row.kind, row.waiting, row.approval).map((action) => (
              <ActionButton key={action.label} api={api} refName={row.ref} action={action} />
            ))}
            <span class="since">{ago(row.since)}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}
