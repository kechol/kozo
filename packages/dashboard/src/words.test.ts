import { describe, expect, test } from "bun:test";
import { ago, eventLine, titleOf, usd } from "./format.ts";
import { en, fill, ja, say } from "./words.ts";

/** The names of the values a sentence takes, in order of first appearance. */
const names = (sentence: string) => [
  ...new Set([...sentence.matchAll(/\{(\w+)\}/g)].map((match) => match[1])),
];

describe("the catalogs", () => {
  test("name the same words, and the same values in each", () => {
    expect(Object.keys(ja).sort()).toEqual(Object.keys(en).sort());
    for (const [key, sentence] of Object.entries(en)) {
      expect(names(ja[key as keyof typeof ja]).sort(), key).toEqual(names(sentence).sort());
    }
  });

  test("leave no word empty", () => {
    for (const catalog of [en, ja]) {
      for (const [key, sentence] of Object.entries(catalog)) expect(sentence, key).not.toBe("");
    }
  });
});

describe("say and fill", () => {
  test("put each value where its name stands, and leave a missing one out", () => {
    expect(say("en", "runs.line", { agent: "implement", target: "K-1/t1" })).toBe(
      "implement on K-1/t1",
    );
    expect(say("ja", "runs.line", { agent: "implement", target: "K-1/t1" })).toBe(
      "implement（K-1/t1）",
    );
    expect(fill("a {x} b {y}", { x: 1 })).toEqual(["a ", 1, " b "]);
  });
});

describe("format in Japanese", () => {
  test("words an event's frame and keeps the reason kozod worded", () => {
    expect(
      eventLine(
        { type: "hold.set", data: { target: "task", hold: "attention", reason: "ゲートが失敗" } },
        "ja",
      ),
    ).toBe("task に hold（attention）: ゲートが失敗");
    expect(
      eventLine({ type: "hold.cleared", data: { target: "task", hold: "paused" } }, "ja"),
    ).toBe("task の hold（paused）を解除");
    expect(eventLine({ type: "node.exit", data: { ok: false, summary: "lint" } }, "ja")).toBe(
      "失敗: lint",
    );
    expect(
      eventLine(
        { type: "gates.result", data: { level: "full", status: "fail", failed: "lint" } },
        "ja",
      ),
    ).toBe("full gates: fail（lint）");
  });

  test("says how long ago, what a cost is and what titles the tab", () => {
    const now = new Date("2026-10-23T12:00:00Z");
    expect(ago("2026-10-23T11:59:30Z", now, "ja")).toBe("たった今");
    expect(ago("2026-10-23T11:15:00Z", now, "ja")).toBe("45 分前");
    expect(ago("2026-10-23T09:00:00Z", now, "ja")).toBe("3 時間前");
    expect(ago("2026-10-21T09:00:00Z", now, "ja")).toBe("2 日前");
    expect(usd(3.4, "en")).toBe("$3.40");
    expect(usd(3.4, "ja")).toBe("$3.40");
    expect(titleOf({ page: "board" }, 2, "ja")).toBe("(2) Board · kozo");
  });
});
