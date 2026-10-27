import { randomBytes } from "node:crypto";
import { secretMatches } from "@kozo/core";

const codeLifetimeMs = 60_000;
// A page left open keeps its session through its own calls; one unused for a day is gone.
const sessionIdleMs = 24 * 60 * 60 * 1000;

const secret = () => randomBytes(32).toString("hex");

/**
 * The dashboard's sessions. `kozo dashboard` asks for a code with the API token and opens the
 * page with it; the code is good once, for a minute, since a process's arguments are visible to
 * other users of the machine. The page trades it for a session token, which only this kozod
 * process accepts until it goes unused for a day, so the API token itself never reaches the
 * browser.
 */
export class DashboardSessions {
  private readonly codes = new Map<string, number>();
  /** Each session token, with when it was last used. */
  private readonly tokens = new Map<string, number>();

  constructor(private readonly now: () => number = Date.now) {}

  code(): string {
    const code = secret();
    this.codes.set(code, this.now() + codeLifetimeMs);
    return code;
  }

  /** The session token for a code that is good, which the code is no longer; else null. */
  redeem(code: string): string | null {
    for (const [known, expires] of this.codes) {
      if (expires < this.now()) this.codes.delete(known);
    }
    const found = [...this.codes.keys()].find((known) => secretMatches(code, known));
    if (found === undefined) return null;
    this.codes.delete(found);
    const token = secret();
    this.tokens.set(token, this.now());
    return token;
  }

  // A session token is 256 random bits, so looking it up by value tells a guesser nothing.
  accepts(token: string): boolean {
    const now = this.now();
    for (const [known, used] of this.tokens) {
      if (now - used > sessionIdleMs) this.tokens.delete(known);
    }
    if (!this.tokens.has(token)) return false;
    this.tokens.set(token, now);
    return true;
  }
}
