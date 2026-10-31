import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { render } from "preact";
import { act } from "preact/test-utils";
import { type Action, ActionButton, cancelAction } from "./actions.tsx";
import { AddItem } from "./add-item.tsx";
import { Api } from "./api.ts";
import { status, toasts } from "./store.ts";

// The components run in a DOM of their own; the globals they read are put back afterwards, so
// the other test files keep Bun's own.
const window = new Window({ url: "http://127.0.0.1:7420/" });
const globals = ["window", "document", "Node", "HTMLElement", "KeyboardEvent"] as const;
const saved = globals.map((name) => [name, Reflect.get(globalThis, name)] as const);

beforeAll(() => {
  for (const name of globals) {
    Reflect.set(globalThis, name, name === "window" ? window : Reflect.get(window, name));
  }
});

afterAll(() => {
  for (const [name, value] of saved) Reflect.set(globalThis, name, value);
  window.close();
});

let root: HTMLElement;
beforeEach(() => {
  const main = window.document.createElement("main");
  main.tabIndex = -1;
  window.document.body.replaceChildren(main);
  root = main as unknown as HTMLElement;
  toasts.value = [];
});

/** An API whose verbs answer `verb` with `answer`, and whose reads answer empty lists. */
function answering(verb: { status: number; body: unknown }) {
  return new Api("token", async (_input, init) =>
    init?.method === "POST" ? Response.json(verb.body, { status: verb.status }) : Response.json([]),
  );
}

const answer: Action = {
  verb: "say",
  label: "Answer",
  emphasis: "primary",
  text: { field: "text", required: true, placeholder: "Your answer" },
};

const active = () => window.document.activeElement as unknown as HTMLElement | null;
const button = (text: string) =>
  [...root.querySelectorAll("button")].find((node) => node.textContent?.startsWith(text)) as
    | HTMLButtonElement
    | undefined;
const key = (target: Element, init: { key: string; metaKey?: boolean }) => {
  target.dispatchEvent(new window.KeyboardEvent("keydown", { bubbles: true, ...init }) as never);
};

async function mount(node: preact.ComponentChild) {
  await act(() => render(node, root));
}

async function typeInto(field: HTMLTextAreaElement | HTMLInputElement, value: string) {
  await act(() => {
    field.value = value;
    field.dispatchEvent(new window.Event("input", { bubbles: true }) as never);
  });
}

describe("ActionButton", () => {
  test("opens its field with focus in it, and Escape gives focus back to the verb", async () => {
    await mount(
      <ActionButton api={answering({ status: 200, body: {} })} refName="K-1" action={answer} />,
    );
    await act(() => button("Answer")?.click());
    const field = root.querySelector("textarea");
    expect(active()).toBe(field as unknown as HTMLElement);
    await act(() => key(field as Element, { key: "Escape" }));
    expect(root.querySelector("textarea")).toBeNull();
    expect(active()).toBe(button("Answer") as HTMLElement);
  });

  test("says a failure in its field rather than in a toast", async () => {
    const api = answering({ status: 409, body: { error: "K-1 is not waiting for an answer" } });
    await mount(<ActionButton api={api} refName="K-1" action={answer} />);
    await act(() => button("Answer")?.click());
    await typeInto(root.querySelector("textarea") as HTMLTextAreaElement, "Both the same");
    await act(async () => {
      key(root.querySelector("textarea") as Element, { key: "Enter", metaKey: true });
      await Bun.sleep(10);
    });
    expect(root.querySelector("[role=alert]")?.textContent).toBe(
      "K-1 is not waiting for an answer",
    );
    expect(toasts.value).toEqual([]);
  });

  test("asks before closing work in an alert dialog named by its question", async () => {
    await mount(
      <ActionButton
        api={answering({ status: 200, body: {} })}
        refName="K-7"
        action={cancelAction}
      />,
    );
    await act(() => button("Cancel")?.click());
    const dialog = root.querySelector("dialog");
    expect(dialog?.getAttribute("role")).toBe("alertdialog");
    const named = dialog?.getAttribute("aria-labelledby") ?? "";
    expect(window.document.getElementById(named)?.textContent).toBe("Cancel K-7?");
  });

  test("hands focus to the next row's first verb when its own row goes", async () => {
    const api = answering({ status: 200, body: { message: "answered" } });
    const rows = (refs: string[]) => (
      <ul>
        {refs.map((ref) => (
          <li key={ref}>
            <div class="actions">
              <ActionButton
                api={api}
                refName={ref}
                action={{ verb: "take", label: `Take ${ref}` }}
              />
            </div>
          </li>
        ))}
      </ul>
    );
    await mount(rows(["K-1", "K-2"]));
    (button("Take K-1") as HTMLElement).focus();
    await mount(rows(["K-2"]));
    expect(active()).toBe(button("Take K-2") as HTMLElement);
    await mount(rows([]));
    expect(active()).toBe(root);
  });
});

describe("AddItem", () => {
  test("asks for a repository before adding when the factory has several", async () => {
    status.value = {
      mode: "local",
      paused: false,
      pausedReason: null,
      activeRuns: 0,
      waiting: 0,
      costTodayUsd: 0,
      repositories: ["example/shop", "example/api"],
    };
    await mount(<AddItem api={answering({ status: 201, body: { message: "added K-3" } })} />);
    await act(() => button("New item")?.click());
    await typeInto(root.querySelector("dialog input") as HTMLInputElement, "Fix the footer");
    expect(button("Add item")?.disabled).toBe(true);
    const select = root.querySelector("dialog select") as HTMLSelectElement;
    await act(() => {
      select.value = "example/api";
      select.dispatchEvent(new window.Event("change", { bubbles: true }) as never);
    });
    expect(button("Add item")?.disabled).toBe(false);
    status.value = null;
  });
});
