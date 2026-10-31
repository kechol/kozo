import { useEffect, useRef, useState } from "preact/hooks";
import type { Api, RunRow } from "./api.ts";
import { detailHash, usd } from "./format.ts";
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
          <RunsNow api={api} count={current.activeRuns} />
          <span>{usd(current.costTodayUsd)} today</span>
          <span class="mode">{current.mode}</span>
          <button
            type="button"
            onClick={() =>
              void run(api, () => api.post(paused ? "/api/factory/resume" : "/api/factory/pause"))
            }
          >
            <Icon name={paused ? "play" : "pause"} />
            {paused ? "Resume factory" : "Pause factory"}
          </button>
        </fieldset>
      ) : null}
    </header>
  );
}

/**
 * How many runs run now, opening onto which they are; the list is read when it opens, and it
 * closes on Escape, on a click outside it or on following one of its links.
 */
function RunsNow({ api, count }: { api: Api; count: number }) {
  const [open, setOpen] = useState(false);
  const [runs, setRuns] = useState<RunRow[] | null>(null);
  const holder = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (!open) return;
    setRuns(null);
    void api
      .get<RunRow[]>("/api/ls/runs")
      .then((all) => setRuns(all.filter((run) => run.state === "running")))
      .catch(() => setRuns([]));
    const outside = (event: PointerEvent) => {
      if (!holder.current?.contains(event.target as Node)) holder.current?.removeAttribute("open");
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [api, open]);
  const label = `${count} ${count === 1 ? "run" : "runs"}`;
  if (count === 0) return <span>{label}</span>;
  return (
    <details
      ref={holder}
      class="runs-now"
      onToggle={(event) => setOpen(event.currentTarget.open)}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.currentTarget.open = false;
        event.currentTarget.querySelector("summary")?.focus();
      }}
    >
      <summary>{label}</summary>
      <div class="popover">
        {runs === null ? (
          <p>Reading the runs…</p>
        ) : runs.length === 0 ? (
          <p>No run is running now.</p>
        ) : (
          <ul>
            {runs.map((run) => (
              <li key={run.ref}>
                <a
                  class="ref"
                  href={detailHash(run.ref)}
                  onClick={() => holder.current?.removeAttribute("open")}
                >
                  {run.ref}
                </a>{" "}
                {run.agent} on {run.task ?? run.item}
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}
