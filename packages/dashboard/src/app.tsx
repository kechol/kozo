import { signal } from "@preact/signals";
import type { ComponentChildren } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { type Api, endSession } from "./api.ts";
import { Board } from "./board.tsx";
import { DetailView } from "./detail.tsx";
import { type Route, routeOf, titleOf } from "./format.ts";
import { Header } from "./header.tsx";
import { Inbox } from "./inbox.tsx";
import { sessionEnded, waiting } from "./store.ts";
import { Toasts } from "./toasts.tsx";
import { Unreachable } from "./unreachable.tsx";

const route = signal(routeOf(window.location.hash));
window.addEventListener("hashchange", () => {
  route.value = routeOf(window.location.hash);
});

export function App({ api }: { api: Api }) {
  const current = route.value;
  const count = waiting.value;
  const main = useRef<HTMLElement>(null);
  const first = useRef(true);

  useEffect(() => {
    document.title = titleOf(current, count);
  }, [current, count]);

  // A new view takes focus, so that keyboard and screen reader users start reading it.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    main.current?.focus();
  }, [current]);

  if (sessionEnded.value) return <NoToken ended />;
  return (
    <>
      <Header api={api} page={current.page} />
      <Unreachable api={api} />
      <main ref={main} tabIndex={-1} class={current.page === "board" ? "wide" : undefined}>
        <View api={api} route={current} count={count} />
      </main>
      <Toasts />
    </>
  );
}
function View({ api, route, count }: { api: Api; route: Route; count: number }) {
  if (route.page === "detail") return <DetailView key={route.ref} api={api} refName={route.ref} />;
  if (route.page === "board") {
    return (
      <>
        <PageHead title="Board" />
        <Board api={api} />
      </>
    );
  }
  return (
    <>
      <PageHead title="Inbox">
        {count > 0 ? <p>{count} waiting for you, oldest first</p> : null}
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
      <h1>{ended ? "The session ended" : "kozo"}</h1>
      <p>
        {ended ? "kozod no longer takes this tab's session, as after it starts again. " : null}
        Open the dashboard with <code>kozo dashboard</code>, which opens a session for this tab.
        Each link it opens works once, within a minute.
      </p>
    </main>
  );
}
