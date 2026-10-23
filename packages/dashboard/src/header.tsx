import type { Api } from "./api.ts";
import { usd } from "./format.ts";
import { problem, run, status } from "./store.ts";

/** The factory at a glance: its mode, whether it runs, what runs and waits, and today's cost. */
export function Header({ api }: { api: Api }) {
  const current = status.value;
  return (
    <header class="status">
      <strong class="brand">kozo</strong>
      {current ? (
        <>
          <span class="mode">{current.mode} mode</span>
          <span class={current.paused ? "state paused" : "state running"}>
            {current.paused ? `paused: ${current.pausedReason ?? ""}` : "running"}
          </span>
          <span>{current.activeRuns} running</span>
          <span>{current.waiting} waiting</span>
          <span>{usd(current.costTodayUsd)} today</span>
          <button
            type="button"
            class="quiet"
            onClick={() =>
              void run(api, () =>
                api.post(current.paused ? "/api/factory/resume" : "/api/factory/pause"),
              )
            }
          >
            {current.paused ? "Resume the factory" : "Pause the factory"}
          </button>
        </>
      ) : null}
      {problem.value ? <span class="problem">kozod: {problem.value}</span> : null}
    </header>
  );
}
