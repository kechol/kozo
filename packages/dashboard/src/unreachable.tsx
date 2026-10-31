import type { Api } from "./api.ts";
import { Icon } from "./icons.tsx";
import { problem, refresh, refreshedAt } from "./store.ts";

/**
 * Says when kozod cannot be reached and how old what the page shows is. The region is always in
 * the page, so that a screen reader announces the banner when it appears.
 */
export function Unreachable({ api }: { api: Api }) {
  const reason = problem.value;
  const last = refreshedAt.value;
  return (
    <div role="alert">
      {reason ? (
        <div class="banner negative">
          <Icon name="alert" />
          <p>
            <strong>kozod cannot be reached.</strong>{" "}
            {last ? (
              <>
                The page shows what it said at{" "}
                <time dateTime={last.toISOString()}>{last.toLocaleTimeString()}</time>, and tries
                again every few seconds.
              </>
            ) : (
              "The page tries again every few seconds."
            )}{" "}
            <span class="banner-reason">{reason}</span>
          </p>
          <button type="button" onClick={() => void refresh(api)}>
            Try now
          </button>
        </div>
      ) : null}
    </div>
  );
}
