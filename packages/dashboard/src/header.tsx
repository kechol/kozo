import type { Api } from "./api.ts";
import { usd } from "./format.ts";
import { Icon } from "./icons.tsx";
import { inbox, run, status } from "./store.ts";

/** The factory at a glance: the views, whether it runs, what runs, and today's cost. */
export function Header({ api, page }: { api: Api; page: string }) {
  const current = status.value;
  const waiting = inbox.value.length;
  return (
    <header class="appbar">
      <a class="brand" href="#/">
        <span class="brand-mark" aria-hidden="true" />
        kozo
      </a>
      <nav class="tabs" aria-label="Views">
        <a class="tab" href="#/" aria-current={page === "inbox" ? "page" : undefined}>
          Inbox
          {waiting > 0 ? (
            <span class="count">
              {waiting}
              <span class="sr-only"> waiting</span>
            </span>
          ) : null}
        </a>
        <a class="tab" href="#/board" aria-current={page === "board" ? "page" : undefined}>
          Board
        </a>
      </nav>
      {current ? (
        <fieldset class="factory">
          <legend class="sr-only">Factory</legend>
          <span class={current.paused ? "factory-state paused" : "factory-state"}>
            <Icon name={current.paused ? "pause" : "dot"} />
            {current.paused ? "Paused" : "Running"}
          </span>
          {current.paused && current.pausedReason ? (
            <span class="paused-reason" title={current.pausedReason}>
              {current.pausedReason}
            </span>
          ) : null}
          <span>
            {current.activeRuns} {current.activeRuns === 1 ? "run" : "runs"}
          </span>
          <span>{usd(current.costTodayUsd)} today</span>
          <span class="mode">{current.mode}</span>
          <button
            type="button"
            aria-label={current.paused ? "Resume the factory" : "Pause the factory"}
            onClick={() =>
              void run(api, () =>
                api.post(current.paused ? "/api/factory/resume" : "/api/factory/pause"),
              )
            }
          >
            <Icon name={current.paused ? "play" : "pause"} />
            {current.paused ? "Resume" : "Pause"}
          </button>
        </fieldset>
      ) : null}
    </header>
  );
}
