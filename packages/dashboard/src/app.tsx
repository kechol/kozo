import { signal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { AddItem } from "./add-item.tsx";
import type { Api } from "./api.ts";
import { Board } from "./board.tsx";
import { DetailView } from "./detail.tsx";
import { routeOf, titleOf } from "./format.ts";
import { Header } from "./header.tsx";
import { Inbox } from "./inbox.tsx";
import { inbox, notice, status } from "./store.ts";

const route = signal(routeOf(window.location.hash));
window.addEventListener("hashchange", () => {
  route.value = routeOf(window.location.hash);
});

export function App({ api }: { api: Api }) {
  const shown = notice.value;
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

  return (
    <>
      <Header api={api} page={current.page} />
      {shown ? (
        <p role="status" class={shown.failed ? "notice failed" : "notice"}>
          {shown.text}
        </p>
      ) : null}
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
    </>
  );
}
/** What the page shows without a token: how to open it with one. */
export function NoToken() {
  return (
    <main class="no-token">
      <h1>kozo</h1>
      <p>
        Open the dashboard with <code>kozo dashboard</code>, which opens a session for this tab.
        Each link it opens works once, within a minute.
      </p>
    </main>
  );
}
