import type { Api } from "./api.ts";
import { Icon } from "./icons.tsx";
import { problem, refresh, refreshedAt } from "./store.ts";
import { Time } from "./time.tsx";
import { t, tx } from "./words.ts";

/**
 * Says when kozod cannot be reached and how old what the page shows is. The region is always in
 * the page, so that a screen reader announces the banner when it appears.
 */
export function Unreachable({ api }: { api: Api }) {
  const reason = problem.value;
  return (
    <div role="alert">
      {reason ? (
        <div class="banner negative">
          <Icon name="alert" />
          <p>
            <strong>{t("unreachable.title")}</strong>{" "}
            {refreshedAt.value
              ? tx("unreachable.stale", {
                  time: <Time iso={refreshedAt.value.toISOString()} as="clock" />,
                })
              : t("unreachable.retry")}{" "}
            <span class="banner-reason">{reason}</span>
          </p>
          <button type="button" onClick={() => void refresh(api)}>
            {t("unreachable.now")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
