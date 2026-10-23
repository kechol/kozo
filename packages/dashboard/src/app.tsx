import { signal } from "@preact/signals";
import { AddItem } from "./add-item.tsx";
import type { Api } from "./api.ts";
import { Board } from "./board.tsx";
import { DetailView } from "./detail.tsx";
import { routeOf } from "./format.ts";
import { Header } from "./header.tsx";
import { Inbox } from "./inbox.tsx";
import { notice, status } from "./store.ts";

const route = signal(routeOf(window.location.hash));
window.addEventListener("hashchange", () => {
  route.value = routeOf(window.location.hash);
});

export function App({ api }: { api: Api }) {
  const shown = notice.value;
  const page = route.value.page;
  return (
    <>
      <Header api={api} page={page} />
      {shown ? (
        <p role="status" class={shown.failed ? "notice failed" : "notice"}>
          {shown.text}
        </p>
      ) : null}
      <main>
        {route.value.page === "detail" ? (
          <DetailView api={api} refName={route.value.ref} />
        ) : page === "board" ? (
          <>
            <h2>Board</h2>
            {status.value?.mode === "local" ? <AddItem api={api} /> : null}
            <Board api={api} />
          </>
        ) : (
          <>
            <h2>Inbox</h2>
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
