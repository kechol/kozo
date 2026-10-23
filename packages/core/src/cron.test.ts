import { describe, expect, test } from "bun:test";
import { parseAutomation } from "./automation.ts";
import { parseSchedule, type Schedule } from "./cron.ts";
import { factoryTemplate } from "./factory-template.ts";

const at = (text: string) => new Date(text);
const schedule = (expression: string): Schedule => {
  const parsed = parseSchedule(expression);
  if (typeof parsed === "string") throw new Error(parsed);
  return parsed;
};

describe("parseSchedule", () => {
  test("matches numbers, lists, ranges and steps in local time", () => {
    const nightly = schedule("0 3 * * *");
    expect(nightly.matches(at("2026-10-23T03:00:00"))).toBe(true);
    expect(nightly.matches(at("2026-10-23T03:01:00"))).toBe(false);
    const working = schedule("*/15 9-17 * * 1-5");
    expect(working.matches(at("2026-10-23T09:45:00"))).toBe(true);
    expect(working.matches(at("2026-10-23T18:00:00"))).toBe(false);
    // 2026-10-25 is a Sunday, which 0 and 7 both name.
    expect(working.matches(at("2026-10-25T10:00:00"))).toBe(false);
    expect(schedule("0 12 * * 7").matches(at("2026-10-25T12:00:00"))).toBe(true);
    expect(schedule("0 0 1,15 * *").matches(at("2026-10-15T00:00:00"))).toBe(true);
  });

  test("matches either day field when both are restricted, as cron does", () => {
    const either = schedule("0 0 1 * 5");
    expect(either.matches(at("2026-11-01T00:00:00"))).toBe(true);
    expect(either.matches(at("2026-10-23T00:00:00"))).toBe(true);
    expect(either.matches(at("2026-10-22T00:00:00"))).toBe(false);
  });

  test("says why an expression is not a schedule", () => {
    expect(parseSchedule("0 3 * *")).toBe(
      "a schedule has five fields (minute hour day-of-month month day-of-week), not 4",
    );
    expect(parseSchedule("60 3 * * *")).toBe('the minute field allows 0 to 59, not "60"');
    expect(parseSchedule("0 3 * JAN *")).toBe(
      'the month field has "JAN", not a number, range, list or step',
    );
    expect(parseSchedule("*/0 * * * *")).toBe('the minute field allows 0 to 59, not "*/0"');
  });
});

describe("parseAutomation", () => {
  test("the template's nightly automation parses", () => {
    const nightly = parseAutomation(
      "nightly-habit",
      factoryTemplate["automations/nightly-habit.md"],
    );
    expect(nightly).toMatchObject({
      name: "nightly-habit",
      repository: null,
      class: "bugfix",
      title: "Fix one error that the code swallows",
    });
    expect(nightly.schedule.matches(at("2026-10-23T03:00:00"))).toBe(true);
  });

  test("refuses a bad schedule and a request without a title", () => {
    expect(() =>
      parseAutomation("x", "---\nversion: 1\nschedule: nightly\n---\n# Do it\n"),
    ).toThrow("schedule: a schedule has five fields");
    expect(() =>
      parseAutomation("x", '---\nversion: 1\nschedule: "0 3 * * *"\n---\nDo it\n'),
    ).toThrow("the request has no # title");
  });
});
