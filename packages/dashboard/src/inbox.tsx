import { type Action, ActionButton, actionKey, inboxActions } from "./actions.tsx";
import type { Api, InboxRow } from "./api.ts";
import { HoldBadge } from "./badge.tsx";
import { detailHash, route } from "./format.ts";
import { Icon } from "./icons.tsx";
import { Loading, Placeholder, Unread } from "./placeholder.tsx";
import { inbox, items, loaded, problem, status } from "./store.ts";
import { Time } from "./time.tsx";
import { t } from "./words.ts";

/** The line under a row's title; an approval's reason only repeats its badge. */
function Note({ row }: { row: InboxRow }) {
  if (row.waiting === "approval") return null;
  const text = row.waiting === "merge" ? t("inbox.mergeNote") : row.reason;
  return text ? <p class="reason">{text}</p> : null;
}

/**
 * A plan is read before it is approved, so a plan approval's row leads with reading it and keeps
 * approving and rejecting as secondary verbs.
 */
const planRead = (row: InboxRow, action: Action): Action =>
  row.approval === "plan" && action.emphasis === "primary"
    ? { ...action, emphasis: undefined }
    : action;

/** What waits for the human, oldest first, each with the verbs that settle it. */
export function Inbox({ api }: { api: Api }) {
  const rows = inbox.value;
  const open = route.value.ref;
  // A factory with one repository need not say which one each row is in.
  const several = (status.value?.repositories.length ?? 0) > 1;
  const repositoryOf = new Map(items.value.map((item) => [item.ref, item.repository]));
  if (!loaded.value) {
    if (problem.value) return <Unread what={t("what.inbox")} />;
    return (
      <div class="panel rows">
        <Loading what={t("what.inbox")} />
        {[0, 1, 2].map((index) => (
          <div key={index} class="inbox-row">
            <Placeholder />
          </div>
        ))}
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div class="panel empty-state">
        <Icon name="check" />
        <p>
          <strong>{t("inbox.emptyTitle")}</strong>
          {t("inbox.emptyBody")}
        </p>
      </div>
    );
  }
  return (
    <ul class="panel rows">
      {rows.map((row) => (
        <li key={`${row.ref} ${row.waiting}`} class="inbox-row">
          <div class="row-head">
            <HoldBadge hold={row.waiting} approval={row.approval} />
            <h2 class="row-heading">
              <a
                href={detailHash(row.ref)}
                class="row-title"
                aria-current={row.ref === open ? "true" : undefined}
              >
                {row.title}
              </a>
            </h2>
            <span class="ref">{row.ref}</span>
            {several ? (
              <span class="ref">{repositoryOf.get(row.ref.replace(/\/t\d+$/, ""))}</span>
            ) : null}
            <Time iso={row.since} />
          </div>
          <Note row={row} />
          <div class="row actions">
            {row.approval === "plan" ? (
              <a class="button-link primary" href={detailHash(row.ref)}>
                {t("inbox.readPlan")}
              </a>
            ) : null}
            {inboxActions(row.kind, row.waiting, row.approval).map((action) => (
              <ActionButton
                key={actionKey(action)}
                api={api}
                refName={row.ref}
                action={planRead(row, action)}
              />
            ))}
            {row.waiting === "merge" ? (
              <a class="button-link" href={detailHash(row.ref)}>
                {t("inbox.readDiff")}
              </a>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}
