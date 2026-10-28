import type { Event, Factory, FactoryState, Hold } from "@kozo/core";
import type { EventStore } from "./event-store.ts";
import { costToday, midnightOf } from "./queries.ts";

/** Shows one notification; it never throws, since a missed notification stops nothing. */
export type Notify = (title: string, body: string) => Promise<void>;

/**
 * The OS's own notifications: Notification Center through osascript on macOS, notify-send on
 * Linux, and none elsewhere or with `KOZO_NOTIFY=off`. The text goes as an argument, never into
 * the script, since it may carry a request's or an agent's words.
 */
export function osNotify(env: Record<string, string | undefined> = process.env): Notify {
  if (env.KOZO_NOTIFY === "off") return async () => {};
  const command =
    process.platform === "darwin"
      ? (title: string, body: string) => [
          "/usr/bin/osascript",
          "-e",
          "on run argv",
          "-e",
          "display notification (item 2 of argv) with title (item 1 of argv)",
          "-e",
          "end run",
          title,
          body,
        ]
      : Bun.which("notify-send")
        ? (title: string, body: string) => ["notify-send", "--", title, body]
        : null;
  if (!command) return async () => {};
  return async (title, body) => {
    const child = Bun.spawn(command(title, body), {
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
    });
    await child.exited.catch(() => {});
  };
}

const notifiedHolds: readonly Hold["kind"][] = ["approval", "question", "attention"];
const budgetShares = [0.5, 0.8, 1] as const;
const reminderMs = 2 * 24 * 60 * 60 * 1000;
const reminders = 3;

/**
 * Tells the human when they must act, as each event arrives: a task ready to merge, a hold
 * kozod set for them, the day's spending crossing a share of the budget, the factory pausing on
 * its own and a refused factory definition. `remind` adds the approvals that have waited.
 */
export class Notifier {
  /**
   * Today's spending, from the index once and then from each event's cost, with the local
   * midnight it counts from and the highest share of the budget told so far.
   */
  private budget = { since: 0, spent: 0, told: 0 };
  /** How many reminders each waiting approval has had, by its reference and hold time. */
  private readonly reminded = new Map<string, number>();
  private unsubscribe: (() => void) | null = null;
  /** The notifications on their way, which `settled` waits for. */
  private readonly pending = new Set<Promise<void>>();

  constructor(
    private readonly store: EventStore,
    private readonly factory: () => Factory,
    private readonly notify: Notify,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Starts following new events; spending before now counts as told. */
  start() {
    const spent = costToday(this.store.db, this.now());
    this.budget = {
      since: midnightOf(this.now()).getTime(),
      spent,
      told: spent / this.factory().budget.daily_usd,
    };
    this.unsubscribe = this.store.subscribe((event) => {
      const following: Promise<void> = this.follow(event)
        .catch((error: unknown) => console.error(`kozod: a notification failed: ${error}`))
        .finally(() => this.pending.delete(following));
      this.pending.add(following);
    });
  }

  /** Resolves once every event appended so far has been followed. */
  async settled(): Promise<void> {
    await Promise.all(this.pending);
  }

  stop() {
    this.unsubscribe?.();
  }

  private async follow(event: Event) {
    const send = (body: string) => this.notify("kozo", body.slice(0, 240));
    switch (event.type) {
      case "handoff.ready":
        await send(`${event.task} is ready for you to review and merge`);
        break;
      case "hold.set":
        if (event.data.by === "kozod" && notifiedHolds.includes(event.data.hold))
          await send(
            `${event.task ?? event.item} waits for your ${event.data.hold}: ${event.data.reason}`,
          );
        break;
      case "factory.changed":
        if (event.data.paused === true && event.api_call === null)
          await send(`the factory paused: ${event.data.reason}`);
        break;
      case "factory.refused":
        await send(`kozod refused the factory definition: ${event.data.issues.join("; ")}`);
        break;
      case "factory.demoted":
        await send(
          `kozod lowered ${event.data.class} in ${event.data.repository} from ${event.data.from} to ${event.data.to}: ${event.data.reason}; editing the Charter ends it`,
        );
        break;
    }
    const usd = event.cost?.usd ?? 0;
    if (usd > 0) await this.followSpending(usd, send);
  }

  private async followSpending(usd: number, send: (body: string) => Promise<void>) {
    const since = midnightOf(this.now()).getTime();
    if (since !== this.budget.since) this.budget = { since, spent: 0, told: 0 };
    this.budget.spent += usd;
    const budget = this.factory().budget.daily_usd;
    const share = this.budget.spent / budget;
    const crossed = budgetShares.filter((step) => step > this.budget.told && share >= step).at(-1);
    this.budget.told = Math.max(this.budget.told, share);
    if (crossed === undefined) return;
    await send(
      crossed === 1
        ? `the daily budget of ${budget} USD is spent; nothing new starts until midnight`
        : `kozo has spent ${Math.round(crossed * 100)} percent of the daily budget of ${budget} USD`,
    );
  }

  /** Reminds of each approval that has waited two, four or six days since the last reminder. */
  async remind() {
    const state: FactoryState = this.store.state;
    const now = this.now().getTime();
    const waiting = [...Object.values(state.items), ...Object.values(state.tasks)].filter(
      (subject) => subject.hold?.kind === "approval",
    );
    const keyOf = (subject: (typeof waiting)[number]) => `${subject.ref} ${subject.hold?.since}`;
    // An approval given, or one closed, needs no more reminders.
    const still = new Set(waiting.map(keyOf));
    for (const key of this.reminded.keys()) if (!still.has(key)) this.reminded.delete(key);
    for (const subject of waiting) {
      const since = subject.hold?.since ?? "";
      const key = keyOf(subject);
      const due = Math.min(reminders, Math.floor((now - Date.parse(since)) / reminderMs));
      if (due <= (this.reminded.get(key) ?? 0)) continue;
      this.reminded.set(key, due);
      await this.notify(
        "kozo",
        `${subject.ref} has waited ${due * 2} days for your approval: ${subject.hold?.reason ?? ""}`.slice(
          0,
          240,
        ),
      );
    }
  }
}
