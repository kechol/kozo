import { describe, expect, test } from "bun:test";
import { inboxActions } from "./actions.tsx";
import { takeToken } from "./api.ts";
import { ago } from "./format.ts";

const token = "ab".repeat(32);

function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  };
}

describe("takeToken", () => {
  test("moves a token from the fragment into the session and out of the address", () => {
    const session = storage();
    const replaced: string[] = [];
    const location = { hash: `#token=${token}`, pathname: "/", search: "" };
    expect(takeToken(location, session, (url) => replaced.push(url))).toBe(token);
    expect(replaced).toEqual(["/#/"]);
    expect(takeToken({ ...location, hash: "#/board" }, session, () => {})).toBe(token);
  });

  test("takes nothing that is not a whole token", () => {
    const session = storage();
    const location = { hash: "#token=abc", pathname: "/", search: "" };
    expect(takeToken(location, session, () => {})).toBeNull();
    expect(takeToken({ ...location, hash: `#token=${token}x` }, session, () => {})).toBeNull();
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
  test("says how long ago, in the largest whole unit", () => {
    const now = new Date("2026-10-23T12:00:00Z");
    expect(ago("2026-10-23T11:59:30Z", now)).toBe("just now");
    expect(ago("2026-10-23T11:15:00Z", now)).toBe("45 min ago");
    expect(ago("2026-10-21T09:00:00Z", now)).toBe("2 d ago");
  });
});
