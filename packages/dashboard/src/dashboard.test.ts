import { describe, expect, test } from "bun:test";
import {
  holdKindSchema,
  isClosed,
  reviewVerdictSchema,
  runStateSchema,
  stageSchema,
  workClassSchema,
} from "@kozo/core";
import { actionKey, inboxActions } from "./actions.tsx";
import { Api, ApiError, type InboxRow, takeSession } from "./api.ts";
import { detailActions } from "./detail.tsx";
import {
  ago,
  eventLine,
  isClosedStage,
  kindOf,
  moveTarget,
  routeOf,
  stages,
  titleOf,
  workClasses,
} from "./format.ts";
import { Icon, iconNames, toneIcon } from "./icons.tsx";
import {
  dismiss,
  inbox,
  notify,
  problem,
  refresh,
  refreshedAt,
  sessionEnded,
  toastLimit,
  toasts,
} from "./store.ts";
import { Time } from "./time.tsx";
import { toneOf, tones } from "./tone.ts";

const code = "ab".repeat(32);

function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  };
}

describe("takeSession", () => {
  test("takes the code out of the address before trading it, and keeps the session", async () => {
    const session = storage();
    const events: string[] = [];
    const location = { hash: `#code=${code}`, pathname: "/", search: "" };
    const token = await takeSession(
      location,
      session,
      (url) => events.push(`replace ${url}`),
      async (traded) => {
        events.push(`trade ${traded === code}`);
        return "session-token";
      },
    );
    expect(token).toBe("session-token");
    expect(events).toEqual(["replace /#/", "trade true"]);
    const again = await takeSession(
      { ...location, hash: "#/" },
      session,
      () => {},
      async () => null,
    );
    expect(again).toBe("session-token");
  });

  test("trades nothing that is not a whole code, and keeps no session for a refused one", async () => {
    const trades: string[] = [];
    const trade = async (traded: string) => {
      trades.push(traded);
      return null;
    };
    const location = { hash: "#code=abc", pathname: "/", search: "" };
    expect(await takeSession(location, storage(), () => {}, trade)).toBeNull();
    expect(
      await takeSession({ ...location, hash: `#code=${code}` }, storage(), () => {}, trade),
    ).toBeNull();
    expect(trades).toEqual([code]);
  });
});

describe("inboxActions", () => {
  const verbs = (...args: Parameters<typeof inboxActions>) =>
    inboxActions(...args).map((action) => action.label);

  test("offers the verbs that settle what a row waits on, never a merge", () => {
    expect(verbs("item", "approval", "start")).toEqual(["Approve start", "Cancel"]);
    expect(verbs("item", "approval", "plan")).toEqual(["Approve plan", "Reject plan"]);
    expect(verbs("item", "question", null)).toEqual(["Answer"]);
    expect(verbs("task", "question", null)).toEqual(["Answer", "Take it over"]);
    expect(verbs("task", "attention", null)).toEqual([
      "Retry",
      "Take it over",
      "Close as done",
      "Cancel",
    ]);
    expect(verbs("task", "merge", null)).toEqual([]);
  });

  test("makes the verb that settles each row its one primary", () => {
    const primary = (...args: Parameters<typeof inboxActions>) =>
      inboxActions(...args)
        .filter((action) => action.emphasis === "primary")
        .map((action) => action.label);
    expect(primary("item", "approval", "start")).toEqual(["Approve start"]);
    expect(primary("item", "approval", "plan")).toEqual(["Approve plan"]);
    expect(primary("task", "question", null)).toEqual(["Answer"]);
    expect(primary("task", "attention", null)).toEqual(["Retry"]);
    expect(primary("task", "merge", null)).toEqual([]);
  });

  test("asks for the text a verb needs, under the field its body takes", () => {
    const [answer] = inboxActions("item", "question", null);
    expect(answer).toMatchObject({ verb: "say", text: { field: "text", required: true } });
    const reject = inboxActions("item", "approval", "plan")[1];
    expect(reject).toMatchObject({ verb: "reject", text: { field: "reason", required: true } });
    const cancel = inboxActions("item", "approval", "start")[1];
    expect(cancel).toMatchObject({ verb: "close", text: { field: "cancel" }, emphasis: "danger" });
  });

  test("asks before the verbs that close work, and only before them", () => {
    const asking = (...args: Parameters<typeof inboxActions>) =>
      inboxActions(...args)
        .filter((action) => action.confirm)
        .map((action) => action.confirm?.ask("K-7/t1"));
    expect(asking("task", "attention", null)).toEqual(["Close K-7/t1 as done?", "Cancel K-7/t1?"]);
    expect(asking("item", "approval", "start")).toEqual(["Cancel K-7/t1?"]);
    expect(asking("item", "approval", "plan")).toEqual([]);
    expect(asking("task", "question", null)).toEqual([]);
  });
});

describe("format", () => {
  test("lists the stages as kozo defines them, closed ones as closed", () => {
    const listed: string[] = [...stages];
    const closed: string[] = stageSchema.options.filter((stage) => isClosed(stage));
    expect(listed).toEqual(stageSchema.options);
    expect<string[]>(listed.filter(isClosedStage)).toEqual(closed);
  });

  test("lists the work classes as kozo defines them", () => {
    expect<string[]>([...workClasses]).toEqual(workClassSchema.options);
  });

  test("titles the tab with the view, and with how many wait while any do", () => {
    expect(titleOf({ page: "inbox" }, 3)).toBe("(3) Inbox · kozo");
    expect(titleOf({ page: "board" }, 0)).toBe("Board · kozo");
    expect(titleOf({ page: "detail", ref: "K-5/t1" }, 1)).toBe("(1) K-5/t1 · kozo");
  });

  test("routes the inbox, the board and a reference's detail", () => {
    expect(routeOf("")).toEqual({ page: "inbox" });
    expect(routeOf("#/board")).toEqual({ page: "board" });
    expect(routeOf("#/ref/shop%2312%2Ft1")).toEqual({ page: "detail", ref: "shop#12/t1" });
    expect(routeOf("#/ref/%E0%A4%A")).toEqual({ page: "inbox" });
  });

  test("tells items, tasks and runs apart by their references", () => {
    expect(kindOf("K-12")).toBe("item");
    expect(kindOf("app#212")).toBe("item");
    expect(kindOf("app#212/t2")).toBe("task");
    expect(kindOf("r-0042")).toBe("run");
  });

  test("says what an event did in one line", () => {
    expect(
      eventLine({
        type: "stage.changed",
        data: { target: "task", from: "building", to: "reviewing", reason: "checks passed" },
      }),
    ).toBe("task building → reviewing: checks passed");
    expect(
      eventLine({ type: "gates.result", data: { level: "full", status: "fail", failed: "lint" } }),
    ).toBe("full gates fail at lint");
    expect(eventLine({ type: "cost.tick", data: {} })).toBe("");
  });

  test("moves a card above the one above it, or below the one below it", () => {
    const order = ["K-1", "K-2", "K-3", "K-4", "K-5"];
    const column = ["K-1", "K-3", "K-4"];
    expect(moveTarget(column, order, 0, "up")).toBeUndefined();
    expect(moveTarget(column, order, 1, "up")).toBe("K-1");
    expect(moveTarget(column, order, 0, "down")).toBe("K-4");
    expect(moveTarget(column, order, 1, "down")).toBe("K-5");
    expect(moveTarget(["K-4", "K-5"], order, 0, "down")).toBeNull();
    expect(moveTarget(column, order, 2, "down")).toBeUndefined();
  });

  test("says how long ago, in the largest whole unit", () => {
    const now = new Date("2026-10-23T12:00:00Z");
    expect(ago("2026-10-23T11:59:30Z", now)).toBe("just now");
    expect(ago("2026-10-23T11:15:00Z", now)).toBe("45 min ago");
    expect(ago("2026-10-21T09:00:00Z", now)).toBe("2 d ago");
  });
});

describe("detailActions", () => {
  const labels = (...args: Parameters<typeof detailActions>) =>
    detailActions(...args).map((action) => action.label);

  test("offers what each kind takes in its state, never a merge", () => {
    expect(labels("run", null)).toEqual(["Send", "Pause"]);
    expect(labels("item", null)).toEqual(["Send", "Pause", "Cancel"]);
    expect(labels("task", null)).toEqual(["Send", "Pause", "Take it over", "Cancel"]);
    expect(labels("task", "question")).toEqual(["Answer", "Retry", "Take it over", "Cancel"]);
    expect(labels("task", "paused")).toEqual(["Send", "Resume", "Cancel"]);
    expect(labels("task", "taken")).toEqual(["Give it back", "Cancel"]);
  });

  test("offers an approval's decision as the inbox does", () => {
    expect(labels("item", "approval", "plan")).toEqual(["Approve plan", "Reject plan"]);
    expect(labels("item", "approval", "start")).toEqual(["Approve start", "Cancel"]);
  });

  test("offers nothing for closed work or a run that ended", () => {
    expect(labels("item", null, null, true)).toEqual([]);
    expect(labels("run", null, null, true)).toEqual([]);
  });
});

describe("Api.follow", () => {
  const stream = (blocks: string[]) =>
    new Response(new Blob(blocks).stream(), { headers: { "content-type": "text/event-stream" } });
  const block = (id: number, type: string) =>
    `id: ${id}\nevent: event\ndata: ${JSON.stringify({ type })}\n\n`;

  test("connects again from the last event after the stream ends, until it is stopped", async () => {
    const asked: (string | null)[] = [];
    const seen: string[] = [];
    const stop = new AbortController();
    const api = new Api("token", async (_input, init) => {
      asked.push(new Headers(init?.headers).get("last-event-id"));
      if (asked.length === 1) return stream([block(1, "item.created"), block(2, "hold.set")]);
      if (asked.length === 2) return new Response("kozod is starting", { status: 503 });
      stop.abort();
      return stream([block(3, "hold.cleared")]);
    });
    await api.follow("K-1", (event) => seen.push(event.type), stop.signal, { first: 1, max: 2 });
    expect(asked).toEqual([null, "2", "2"]);
    expect(seen).toEqual(["item.created", "hold.set", "hold.cleared"]);
  });

  test("ends when kozod refuses the request, as for a session that ended", async () => {
    let calls = 0;
    const api = new Api("token", async () => {
      calls += 1;
      return new Response("{}", { status: 401 });
    });
    const following = api.follow("K-1", () => {}, new AbortController().signal, {
      first: 1,
      max: 2,
    });
    await expect(following).rejects.toBeInstanceOf(ApiError);
    expect(calls).toBe(1);
  });
});

describe("toneOf", () => {
  test("gives every stage, hold, run state and review verdict kozo defines a tone", () => {
    const keys = (table: object) => Object.keys(table).sort();
    expect(keys(tones.stage)).toEqual([...stageSchema.options].sort());
    expect(keys(tones.hold)).toEqual([...holdKindSchema.options].sort());
    expect(keys(tones.run)).toEqual([...runStateSchema.options].sort());
    expect(keys(tones.review)).toEqual([...reviewVerdictSchema.options].sort());
  });

  test("colours merged work violet, work in progress yellow and failures red", () => {
    expect(toneOf("stage", "complete")).toBe("done");
    expect(toneOf("stage", "building")).toBe("progress");
    expect(toneOf("run", "failed")).toBe("negative");
    expect(toneOf("waiting", "merge")).toBe("positive");
  });

  test("leaves what it does not know, or nothing, neutral", () => {
    expect(toneOf("hold", null)).toBe("neutral");
    expect(toneOf("gates", "unknown")).toBe("neutral");
  });
});

describe("Icon", () => {
  test("draws every glyph as a decoration hidden from assistive technology", () => {
    for (const name of iconNames) {
      const svg = Icon({ name });
      expect(svg.type).toBe("svg");
      expect(svg.props["aria-hidden"]).toBe("true");
      expect(svg.props.children).toBeDefined();
    }
  });

  test("gives each tone its own glyph, so that no state is told by colour alone", () => {
    const glyphs = Object.values(toneIcon);
    for (const glyph of glyphs) expect(iconNames).toContain(glyph);
    expect(new Set(glyphs).size).toBe(glyphs.length);
  });
});

describe("Time", () => {
  test("shows nothing for a value that is not a time, rather than throwing", () => {
    expect(Time({ iso: "" })).toBeNull();
    expect(Time({ iso: "2026-10-31T09:00:00Z", as: "clock" })?.type).toBe("time");
  });
});

describe("actionKey", () => {
  test("keeps a verb's key when its label changes, and tells apart the verbs that close work", () => {
    const keys = (waiting: string) =>
      inboxActions("task", waiting, null).map((action) => actionKey(action));
    expect(keys("question")[0]).toBe("say");
    const attention = keys("attention");
    expect(new Set(attention).size).toBe(attention.length);
  });
});

describe("toasts", () => {
  test("keeps the newest few, and a failure until it is dismissed", () => {
    toasts.value = [];
    const failure = notify("kozod refused it", true);
    for (const text of ["one", "two", "three"]) notify(text, false);
    expect(toasts.value).toHaveLength(toastLimit);
    expect(toasts.value.map((toast) => toast.text)).toEqual(["kozod refused it", "two", "three"]);
    dismiss(failure);
    expect(toasts.value.map((toast) => toast.text)).toEqual(["two", "three"]);
  });

  test("shows a new answer even when only failures came before it", () => {
    toasts.value = [];
    for (const text of ["one", "two", "three"]) notify(text, true);
    notify("done", false);
    expect(toasts.value.map((toast) => toast.text)).toEqual(["two", "three", "done"]);
    for (const toast of toasts.value) dismiss(toast.id);
  });
});

describe("refresh", () => {
  const answering = (status: number) =>
    new Api("token", async () => Response.json(status === 200 ? [] : { error: "no" }, { status }));

  test("says why kozod cannot be reached and keeps when the page last heard from it", async () => {
    await refresh(answering(200));
    const heard = refreshedAt.value;
    expect(problem.value).toBeNull();
    await refresh(answering(503));
    expect(problem.value).toBe("no");
    expect(refreshedAt.value).toBe(heard);
    expect(sessionEnded.value).toBe(false);
  });

  test("drops an answer that arrives after a later refresh started", async () => {
    const rows = (title: string): InboxRow[] => [
      {
        kind: "item",
        ref: "K-1",
        title,
        waiting: "question",
        reason: null,
        approval: null,
        since: "",
      },
    ];
    const slow = new Api("token", async (input) => {
      if (String(input).endsWith("/inbox")) await Bun.sleep(30);
      return Response.json(String(input).endsWith("/inbox") ? rows("old") : []);
    });
    const fast = new Api("token", async (input) =>
      Response.json(String(input).endsWith("/inbox") ? rows("new") : []),
    );
    const older = refresh(slow);
    await refresh(fast);
    await older;
    expect(inbox.value.map((row) => row.title)).toEqual(["new"]);
  });

  test("ends the page's session when kozod refuses it", async () => {
    await refresh(answering(401));
    expect(sessionEnded.value).toBe(true);
    sessionEnded.value = false;
  });
});
