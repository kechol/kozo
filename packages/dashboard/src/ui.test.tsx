import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { render } from "preact";
import { act } from "preact/test-utils";
import { type Action, ActionButton, Composer, cancelAction } from "./actions.tsx";
import { AddItem } from "./add-item.tsx";
import { Board } from "./board.tsx";
import { route } from "./format.ts";
import { Api, type InboxRow } from "./api.ts";
import { Header } from "./header.tsx";
import { Inbox } from "./inbox.tsx";
import { inbox, items, locale, refreshedAt, status, tasks, toasts } from "./store.ts";

// The components run in a DOM of their own; the globals they read are put back afterwards, so
// the other test files keep Bun's own.
const window = new Window({ url: "http://127.0.0.1:7420/" });
const globals = ["window", "document", "Node", "HTMLElement", "KeyboardEvent", "history"] as const;
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
        action={cancelAction()}
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

describe("Composer", () => {
  const plan: Action[] = [
    {
      verb: "approve",
      label: "Approve plan",
      emphasis: "primary",
      text: { field: "text", required: false, placeholder: "Anything the runs should know" },
    },
    {
      verb: "reject",
      label: "Reject plan",
      text: { field: "reason", required: true, placeholder: "What the plan should change" },
    },
  ];
  /** An API that keeps what each verb sent, and whose reads answer empty lists. */
  function recording() {
    const sent: { url: string; body: unknown }[] = [];
    const api = new Api("token", async (input, init) => {
      if (init?.method === "POST")
        sent.push({ url: String(input), body: JSON.parse(String(init.body)) });
      return Response.json(init?.method === "POST" ? { message: "done" } : []);
    });
    return { api, sent };
  }

  test("opens one field for the verbs that take text, sending the first on Cmd+Enter", async () => {
    const { api, sent } = recording();
    await mount(<Composer api={api} refName="K-12" actions={plan} />);
    const field = root.querySelector("textarea") as HTMLTextAreaElement;
    expect(field.placeholder).toBe(
      "Approve plan: Anything the runs should know (optional)\nReject plan: What the plan should change",
    );
    expect(button("Reject plan")?.disabled).toBe(true);
    await typeInto(field, "Keep the endpoint small");
    expect(button("Reject plan")?.disabled).toBe(false);
    await act(async () => {
      key(field, { key: "Enter", metaKey: true });
      await Bun.sleep(10);
    });
    expect(sent).toEqual([
      { url: "/api/refs/K-12/approve", body: { text: "Keep the endpoint small" } },
    ]);
    expect(field.value).toBe("");
  });

  test("keeps what was typed for a reference while the pane shows another", async () => {
    const { api } = recording();
    await mount(<Composer key="K-12" api={api} refName="K-12" actions={plan} />);
    await typeInto(root.querySelector("textarea") as HTMLTextAreaElement, "Split t2");
    await mount(<Composer key="K-14" api={api} refName="K-14" actions={plan} />);
    expect((root.querySelector("textarea") as HTMLTextAreaElement).value).toBe("");
    await mount(<Composer key="K-12" api={api} refName="K-12" actions={plan} />);
    expect((root.querySelector("textarea") as HTMLTextAreaElement).value).toBe("Split t2");
  });
});

describe("Board", () => {
  test("lists an item's tasks on its card, each opening in the pane", async () => {
    const task = (id: string, goal: string, stage: string, hold: string | null) => ({
      ref: `K-9/${id}`,
      item: "K-9",
      goal,
      stage,
      hold,
      hold_reason: null,
      revisions: 0,
      awaiting_merge: 0,
      updated_at: "2026-11-01T00:00:00Z",
    });
    items.value = [
      {
        ref: "K-9",
        title: "Validate coupon codes",
        stage: "building",
        shown_stage: "building",
      } as never,
    ];
    tasks.value = [
      task("t1", "Reject malformed codes", "complete", null),
      task("t2", "Show the same message", "building", "question"),
    ];
    status.value = null;
    refreshedAt.value = new Date();
    await mount(<Board api={answering({ status: 200, body: {} })} asked="items" />);
    const rows = [...root.querySelectorAll(".card-tasks li")].map((row) => [
      row.querySelector("a")?.getAttribute("href"),
      row.textContent,
    ]);
    expect(rows).toEqual([
      ["#/board?view=items&ref=K-9%2Ft1", "t1Reject malformed codescomplete"],
      ["#/board?view=items&ref=K-9%2Ft2", "t2Show the same messageQuestion"],
    ]);
    items.value = [];
    tasks.value = [];
    route.value = { page: "inbox" };
    refreshedAt.value = null;
    await mount(null);
  });
});

describe("AddItem", () => {
  test("asks for a repository before adding when the factory has several", async () => {
    status.value = {
      mode: "local",
      locale: "en",
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

describe("in Japanese", () => {
  // The views read the stores, so they come down before another file's tests change them.
  afterEach(async () => {
    await act(() => render(null, root));
    locale.value = "en";
    status.value = null;
    inbox.value = [];
    refreshedAt.value = null;
  });

  const row: InboxRow = {
    kind: "item",
    ref: "K-12",
    title: "Show the delivery estimate",
    waiting: "approval",
    reason: null,
    approval: "plan",
    since: new Date().toISOString(),
  };

  test("words the header, an inbox row and its verbs, and follows a change of locale", async () => {
    status.value = {
      mode: "local",
      locale: "en",
      paused: true,
      pausedReason: null,
      activeRuns: 0,
      waiting: 1,
      costTodayUsd: 3.4,
      repositories: ["example/shop"],
    };
    inbox.value = [row];
    refreshedAt.value = new Date();
    const api = answering({ status: 200, body: {} });
    await mount(
      <>
        <Header api={api} page="inbox" />
        <Inbox api={api} />
      </>,
    );
    expect(root.textContent).toContain("Resume factory");
    expect(root.textContent).toContain("Plan approval");
    expect(button("Reject plan")).toBeDefined();

    await act(() => {
      locale.value = "ja";
    });
    expect(root.textContent).toContain("ファクトリーを再開する");
    expect(root.textContent).toContain("計画の承認");
    expect(root.textContent).toContain("計画を読む");
    expect(root.textContent).toContain("たった今");
    expect(root.textContent).toContain("今日 $3.40");
    expect(button("計画を承認")).toBeDefined();
    expect(button("計画を差し戻す")).toBeDefined();
    expect(root.textContent).not.toContain("Resume factory");
  });

  test("words a dialog's question, its body and its way back", async () => {
    locale.value = "ja";
    await mount(
      <ActionButton
        api={answering({ status: 200, body: {} })}
        refName="K-7"
        action={cancelAction()}
      />,
    );
    await act(() => button("取り消す")?.click());
    const dialog = root.querySelector("dialog");
    const named = dialog?.getAttribute("aria-labelledby") ?? "";
    expect(window.document.getElementById(named)?.textContent).toBe("K-7 を取り消しますか？");
    expect(button("戻る")).toBeDefined();
  });
});
