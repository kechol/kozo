import { describe, expect, test } from "bun:test";
import { inboxActions } from "./actions.tsx";
import { takeSession } from "./api.ts";
import { ago, moveTarget, routeOf } from "./format.ts";

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
    expect(verbs("item", "approval", "start approval")).toEqual(["Approve start", "Cancel"]);
    expect(verbs("item", "approval", "plan approval")).toEqual(["Approve plan", "Reject plan"]);
    expect(verbs("item", "question", "ambiguous: which?")).toEqual(["Answer"]);
    expect(verbs("task", "question", "ambiguous: which?")).toEqual(["Answer", "Take it over"]);
    expect(verbs("task", "attention", "gates failed")).toEqual([
      "Retry",
      "Take it over",
      "Close as done",
      "Cancel",
    ]);
    expect(verbs("task", "merge", null)).toEqual([]);
  });

  test("asks for the text a verb needs, under the field its body takes", () => {
    const [answer] = inboxActions("item", "question", null);
    expect(answer).toMatchObject({ verb: "say", text: { field: "text", required: true } });
    const reject = inboxActions("item", "approval", "plan approval")[1];
    expect(reject).toMatchObject({ verb: "reject", text: { field: "reason", required: true } });
    const cancel = inboxActions("item", "approval", "start approval")[1];
    expect(cancel).toMatchObject({ verb: "close", text: { field: "cancel" }, danger: true });
  });
});

describe("format", () => {
  test("routes the inbox and the board", () => {
    expect(routeOf("")).toEqual({ page: "inbox" });
    expect(routeOf("#/board")).toEqual({ page: "board" });
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
