import { signal } from "@preact/signals";
import type { Api, ItemRow, TaskRow } from "./api.ts";
import { detailHash, isClosedStage, moveTarget, stages } from "./format.ts";
import { items, run, tasks } from "./store.ts";
import { toneOf } from "./tone.ts";

/** Whether the board shows items or tasks; the viewer's choice, kept in this browser. */
const view = signal<"items" | "tasks">(readView());

function readView(): "items" | "tasks" {
  try {
    return localStorage.getItem("kozo.board") === "tasks" ? "tasks" : "items";
  } catch {
    return "items";
  }
}

function choose(next: "items" | "tasks") {
  view.value = next;
  try {
    localStorage.setItem("kozo.board", next);
  } catch {}
}

// A closed column keeps its newest cards only; the others are counted.
const closedShown = 10;

/** Items or tasks in one column per stage, with their holds, progress and autonomy level. */
export function Board({ api }: { api: Api }) {
  const showItems = view.value === "items";
  const allItems = items.value;
  const order = allItems.filter((item) => !isClosedStage(item.stage)).map((item) => item.ref);
  return (
    <>
      <div class="row board-tools">
        <fieldset class="toggle">
          <legend class="sr-only">Show</legend>
          <label>
            <input type="radio" checked={showItems} onChange={() => choose("items")} /> Items
          </label>
          <label>
            <input type="radio" checked={!showItems} onChange={() => choose("tasks")} /> Tasks
          </label>
        </fieldset>
      </div>
      <div class="board">
        {stages.map((stage) => {
          const cards = showItems
            ? allItems.filter((item) => item.shown_stage === stage)
            : tasks.value.filter((task) => task.stage === stage);
          const closed = isClosedStage(stage);
          const shown = closed ? cards.slice(-closedShown).reverse() : cards;
          const column = cards.map((card) => card.ref);
          return (
            <section key={stage} class="column" aria-label={stage}>
              <h3>
                {stage} <span class="count">{cards.length}</span>
              </h3>
              {shown.map((card, index) =>
                showItems ? (
                  <ItemCard
                    key={card.ref}
                    api={api}
                    item={card as ItemRow}
                    up={closed ? undefined : moveTarget(column, order, index, "up")}
                    down={closed ? undefined : moveTarget(column, order, index, "down")}
                  />
                ) : (
                  <TaskCard key={card.ref} task={card as TaskRow} />
                ),
              )}
              {closed && cards.length > closedShown ? (
                <p class="more">and {cards.length - closedShown} older</p>
              ) : null}
            </section>
          );
        })}
      </div>
    </>
  );
}

function ItemCard({
  api,
  item,
  up,
  down,
}: {
  api: Api;
  item: ItemRow;
  up: string | null | undefined;
  down: string | null | undefined;
}) {
  const own = tasks.value.filter((task) => task.item === item.ref);
  const done = own.filter((task) => task.stage === "complete").length;
  const held = own.filter((task) => task.hold).length;
  const move = (before: string | null) =>
    void run(api, () => api.act(item.ref, "reorder", { before }));
  return (
    <article class="card board-card">
      <div class="row spread">
        <a href={detailHash(item.ref)} class="ref">
          {item.ref}
        </a>
        {item.level ? (
          <span class="level" title="autonomy level">
            {item.level}
          </span>
        ) : null}
      </div>
      <p class="title">{item.title}</p>
      <div class="row meta">
        {item.hold ? <span class={`badge ${toneOf("hold", item.hold)}`}>{item.hold}</span> : null}
        {item.class ? <span>{item.class}</span> : null}
        {own.length > 0 ? (
          <span>
            {done}/{own.length} tasks{held > 0 ? `, ${held} held` : ""}
          </span>
        ) : null}
      </div>
      {up !== undefined || down !== undefined ? (
        <div class="row reorder">
          <button
            type="button"
            class="quiet small"
            aria-label={`Move ${item.ref} up`}
            disabled={up === undefined}
            onClick={() => up !== undefined && move(up)}
          >
            ↑
          </button>
          <button
            type="button"
            class="quiet small"
            aria-label={`Move ${item.ref} down`}
            disabled={down === undefined}
            onClick={() => down !== undefined && move(down)}
          >
            ↓
          </button>
        </div>
      ) : null}
    </article>
  );
}

function TaskCard({ task }: { task: TaskRow }) {
  return (
    <article class="card board-card">
      <a href={detailHash(task.ref)} class="ref">
        {task.ref}
      </a>
      <p class="title">{task.goal}</p>
      <div class="row meta">
        {task.hold ? <span class={`badge ${toneOf("hold", task.hold)}`}>{task.hold}</span> : null}
        {task.revisions > 0 ? <span>{task.revisions} revisions</span> : null}
      </div>
    </article>
  );
}
