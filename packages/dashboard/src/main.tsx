import { render } from "preact";
import { Api, takeToken } from "./api.ts";
import { App, NoToken } from "./app.tsx";
import { poll } from "./store.ts";

const root = document.getElementById("app") as HTMLElement;
const token = takeToken(window.location, window.sessionStorage, (url) =>
  window.history.replaceState(null, "", url),
);
if (token) {
  const api = new Api(token);
  poll(api);
  render(<App api={api} />, root);
} else {
  render(<NoToken />, root);
}
