import type { Api } from "./api.ts";
import { usd } from "./format.ts";
import { Icon } from "./icons.tsx";
import { run, status, waiting } from "./store.ts";

/** The factory at a glance: the views, whether it runs, what runs, and today's cost. */
export function Header({ api, page }: { api: Api; page: string }) {
  const current = status.value;
  const paused = current?.paused ?? false;
  const count = waiting.value;
  return (
    <header class="appbar">
      <a class="brand" href="#/">
        <span class="brand-mark" aria-hidden="true" />
        kozo
      </a>
      <nav class="tabs" aria-label="Views">
        <a class="tab" href="#/" aria-current={page === "inbox" ? "page" : undefined}>
          Inbox
          {count > 0 ? (
            <span class="count">
              {count}
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
          <span class={`factory-state ${paused ? "neutral" : "positive"}`}>
            <Icon name={paused ? "pause" : "dot"} />
            {paused ? "Paused" : "Running"}
          </span>
          {paused && current.pausedReason ? (
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
            aria-label={paused ? "Resume the factory" : "Pause the factory"}
            onClick={() =>
              void run(api, () => api.post(paused ? "/api/factory/resume" : "/api/factory/pause"))
            }
          >
            <Icon name={paused ? "play" : "pause"} />
            {paused ? "Resume" : "Pause"}
          </button>
        </fieldset>
      ) : null}
    </header>
  );
}
