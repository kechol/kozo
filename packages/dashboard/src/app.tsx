import type { Api } from "./api.ts";
import { Header } from "./header.tsx";
import { Inbox } from "./inbox.tsx";
import { notice } from "./store.ts";

export function App({ api }: { api: Api }) {
  const shown = notice.value;
  return (
    <>
      <Header api={api} />
      {shown ? (
        <p role="status" class={shown.failed ? "notice failed" : "notice"}>
          {shown.text}
        </p>
      ) : null}
      <main>
        <h2>Inbox</h2>
        <Inbox api={api} />
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
        Open the dashboard with <code>kozo dashboard</code>, which hands this tab the API token.
      </p>
    </main>
  );
}
