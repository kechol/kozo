import { signal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { AddItem } from "./add-item.tsx";
import { type Api, endSession } from "./api.ts";
import { Board } from "./board.tsx";
import { DetailView } from "./detail.tsx";
import { routeOf, titleOf } from "./format.ts";
import { Header } from "./header.tsx";
import { Inbox } from "./inbox.tsx";
import { inbox, sessionEnded, status } from "./store.ts";
import { Toasts } from "./toasts.tsx";
import { Unreachable } from "./unreachable.tsx";

const route = signal(routeOf(window.location.hash));
window.addEventListener("hashchange", () => {
  route.value = routeOf(window.location.hash);
});

export function App({ api }: { api: Api }) {
  const current = route.value;
  const waiting = inbox.value.length;
  const main = useRef<HTMLElement>(null);
  const first = useRef(true);

  useEffect(() => {
    document.title = titleOf(current, waiting);
  }, [current, waiting]);

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
      <main ref={main} tabIndex={-1}>
        {current.page === "detail" ? (
          <DetailView key={current.ref} api={api} refName={current.ref} />
        ) : current.page === "board" ? (
          <>
            <div class="page-head">
              <h1>Board</h1>
            </div>
            {status.value?.mode === "local" ? <AddItem api={api} /> : null}
            <Board api={api} />
          </>
        ) : (
          <>
            <div class="page-head">
              <h1>Inbox</h1>
              {waiting > 0 ? <p>{waiting} waiting for you, oldest first</p> : null}
            </div>
            <Inbox api={api} />
          </>
        )}
      </main>
      <Toasts />
    </>
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
