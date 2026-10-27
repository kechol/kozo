import { describe, expect, test } from "bun:test";
import { DashboardSessions } from "./dashboard-session.ts";

describe("DashboardSessions", () => {
  test("a session lasts while it is used and ends after a day without use", () => {
    let now = 0;
    const hour = 60 * 60 * 1000;
    const sessions = new DashboardSessions(() => now);
    const token = sessions.redeem(sessions.code()) ?? "";
    expect(sessions.accepts(token)).toBe(true);
    for (let day = 0; day < 3; day += 1) {
      now += 23 * hour;
      expect(sessions.accepts(token)).toBe(true);
    }
    now += 25 * hour;
    expect(sessions.accepts(token)).toBe(false);
    now += hour;
    expect(sessions.accepts(token)).toBe(false);
  });
});
