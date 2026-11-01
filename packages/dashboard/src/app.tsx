import type { ComponentChildren } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { type Api, endSession } from "./api.ts";
import { Board } from "./board.tsx";
import { DetailView } from "./detail.tsx";
import { listHash, type Route, route, routeOf, titleOf } from "./format.ts";
import { Header } from "./header.tsx";
import { Icon } from "./icons.tsx";
import { Inbox } from "./inbox.tsx";
import { locale, sessionEnded, waiting } from "./store.ts";
import { Toasts } from "./toasts.tsx";
import { Unreachable } from "./unreachable.tsx";
import { t, tx } from "./words.ts";

route.value = routeOf(window.location.hash);
window.addEventListener("hashchange", () => {
  route.value = routeOf(window.location.hash);
});

export function App({ api }: { api: Api }) {
  const current = route.value;
  const count = waiting.value;
  const main = useRef<HTMLElement>(null);
  const first = useRef(true);
  const language = locale.value;

  useEffect(() => {
    document.title = titleOf(current, count, language);
  }, [current, count, language]);

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  // A new view takes focus, so that keyboard and screen reader users start reading it; the pane
  // takes it itself.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    main.current?.focus();
  }, [current.page]);

  if (sessionEnded.value) return <NoToken ended />;
  return (
    <>
      <Header api={api} page={current.page} />
      <Unreachable api={api} />
      <div class={current.ref ? "workspace with-pane" : "workspace"}>
        <main ref={main} tabIndex={-1} class={current.page === "board" ? "wide" : undefined}>
          <View api={api} route={current} count={count} />
        </main>
        {current.ref ? <Pane api={api} refName={current.ref} main={main} /> : null}
      </div>
      <Toasts />
    </>
  );
}

/**
 * A reference's detail beside the list it was opened from, or over its lower part on a narrow
 * screen. The list stays usable; the pane takes focus when it opens or shows another reference,
 * and closing it gives focus back to the row or card that stands for what it showed.
 */
function Pane({
  api,
  refName,
  main,
}: {
  api: Api;
  refName: string;
  main: { current: HTMLElement | null };
}) {
  const pane = useRef<HTMLElement>(null);
  useEffect(() => {
    pane.current?.focus();
  }, [refName]);
  const close = () => {
    const opener = main.current?.querySelector<HTMLElement>('a[aria-current="true"]');
    window.location.hash = listHash();
    (opener ?? main.current)?.focus();
  };
  return (
    <aside
      ref={pane}
      class="pane"
      tabIndex={-1}
      aria-label={t("pane.label", { ref: refName })}
      onKeyDown={(event) => {
        // A field, a disclosure or a dialog inside the pane closes itself first.
        if (event.key !== "Escape" || event.defaultPrevented) return;
        if ((event.target as Element).closest("dialog")) return;
        event.preventDefault();
        close();
      }}
    >
      <button
        type="button"
        class="ghost icon-button pane-close"
        aria-label={t("pane.close")}
        onClick={close}
      >
        <Icon name="x" />
      </button>
      <DetailView key={refName} api={api} refName={refName} />
    </aside>
  );
}

function View({ api, route, count }: { api: Api; route: Route; count: number }) {
  if (route.page === "board") {
    return (
      <>
        <PageHead title={t("nav.board")} />
        <Board api={api} asked={route.view} />
      </>
    );
  }
  return (
    <>
      <PageHead title={t("nav.inbox")}>
        {count > 0 ? <p>{t("inbox.summary", { n: count })}</p> : null}
      </PageHead>
      <Inbox api={api} />
    </>
  );
}

/** A view's one h1, with what it says about the view under it. */
function PageHead({ title, children }: { title: string; children?: ComponentChildren }) {
  return (
    <div class="page-head">
      <h1>{title}</h1>
      {children}
    </div>
  );
}

/** What the page shows without a token, or once kozod ended its session: how to open it. */
export function NoToken({ ended = false }: { ended?: boolean }) {
  useEffect(() => {
    if (ended) endSession(window.sessionStorage);
  }, [ended]);
  return (
    <main class="no-token">
      <h1>{ended ? t("session.ended") : "kozo"}</h1>
      <p>
        {ended ? t("session.endedBody") : null}
        {tx("session.open", { command: <code>kozo dashboard</code> })}
      </p>
    </main>
  );
}
