import { Icon } from "./icons.tsx";
import { t } from "./words.ts";

/**
 * Grey lines where content is loading, at about its final size, so the page does not jump when it
 * arrives. They are hidden from assistive technology; `Loading` says once what is loading.
 */
export function Placeholder({ lines = 3 }: { lines?: number }) {
  return (
    <div class="placeholder" aria-hidden="true">
      {Array.from({ length: lines }, (_, index) => (
        <span key={index} />
      ))}
    </div>
  );
}

export function Loading({ what }: { what: string }) {
  return (
    <p class="sr-only" role="status">
      {t("loading", { what })}
    </p>
  );
}

/** What a view shows when kozod has not answered once; the banner above says why. */
export function Unread({ what }: { what: string }) {
  return (
    <div class="panel empty-state">
      <Icon name="alert" />
      <p>
        <strong>{t("unread.title")}</strong>
        {t("unread.body", { what })}
      </p>
    </div>
  );
}
