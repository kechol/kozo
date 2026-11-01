import { describe, expect, test } from "bun:test";
import { message, messageSchema, proseLanguage, render } from "./message.ts";
import { en } from "./messages/en.ts";
import { ja } from "./messages/ja.ts";

const placeholders = (sentence: string) =>
  [...sentence.matchAll(/\{(\w+)\}/g)].map(([, name]) => name).sort();

describe("messages", () => {
  test("every code names the same values in English and in Japanese", () => {
    const differing = Object.entries(en).filter(
      ([code, sentence]) =>
        JSON.stringify(placeholders(sentence)) !==
        JSON.stringify(placeholders(ja[code as keyof typeof en])),
    );
    expect(differing).toEqual([]);
  });

  test("render puts the values into the locale's sentence", () => {
    const ready = message("notice.ready", { task: "K-3/t1" });
    expect(render(ready, "en")).toBe("K-3/t1 is ready for you to review and merge");
    expect(render(ready, "ja")).toBe("K-3/t1 のレビューとマージの準備ができました");
    expect(render(message("notice.budget-share", { budget: 15, percent: 80 }), "ja")).toBe(
      "1 日の予算 15 USD の 80% を使いました",
    );
  });

  test("a message inside another renders in the same locale", () => {
    const why = message("stage.plan-level", { level: "L2" });
    expect(render(message("stage.plan-feature", { why }), "ja")).toBe(
      "L2 では計画の承認が要ります。plan エージェントが先に、受け入れ条件をあなたと詰めます",
    );
    expect(messageSchema.safeParse(message("stage.plan-feature", { why })).success).toBe(true);
  });

  test("a recorded message must name a known code and carry strings or numbers", () => {
    expect(
      messageSchema.safeParse({ code: "notice.ready", values: { task: "K-1/t1" } }).success,
    ).toBe(true);
    expect(messageSchema.safeParse({ code: "notice.unknown", values: {} }).success).toBe(false);
    expect(messageSchema.safeParse({ code: "notice.ready", values: { task: true } }).success).toBe(
      false,
    );
  });
});

describe("proseLanguage", () => {
  test("tells an agent the language of its prose, and nothing in English", () => {
    expect(proseLanguage("en")).toBeNull();
    expect(proseLanguage("ja")).toStartWith("Write the prose you give people in Japanese");
    expect(proseLanguage("ja")).toContain("copy it unchanged");
  });
});
