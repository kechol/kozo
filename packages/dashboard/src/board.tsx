import { signal } from "@preact/signals";
import { AddItem } from "./add-item.tsx";
import type { Api, ItemRow, TaskRow } from "./api.ts";
import { Badge } from "./badge.tsx";
import { detailHash, isClosedStage, moveTarget, stages } from "./format.ts";
import { Icon } from "./icons.tsx";
import { items, run, status, tasks } from "./store.ts";
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
      <div class="row spread board-tools">
        <fieldset class="segmented">
          <legend class="sr-only">Show</legend>
          <label>
            <input
              type="radio"
              name="board-view"
              checked={showItems}
              onChange={() => choose("items")}
            />
            Items
          </label>
          <label>
            <input
              type="radio"
              name="board-view"
              checked={!showItems}
              onChange={() => choose("tasks")}
            />
            Tasks
          </label>
        </fieldset>
        {status.value?.mode === "local" ? <AddItem api={api} /> : null}
      </div>
      {/* biome-ignore lint/a11y/noNoninteractiveTabindex: a scroller takes focus so the keyboard can scroll it */}
      <section class="board" aria-label="Stages" tabIndex={0}>
        {stages.map((stage) => {
          const cards = showItems
            ? allItems.filter((item) => item.shown_stage === stage)
            : tasks.value.filter((task) => task.stage === stage);
          const closed = isClosedStage(stage);
          const shown = closed ? cards.slice(-closedShown).reverse() : cards;
          const column = cards.map((card) => card.ref);
          const head = (
            <h2>
              {stage} <span class="column-count">{cards.length}</span>
            </h2>
          );
          const list = shown.map((card, index) =>
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
          );
          // A closed column holds what is finished, so it stays folded to its count until opened.
          return closed ? (
            <details key={stage} class="column closed">
              <summary>{head}</summary>
              {list}
              {cards.length > closedShown ? (
                <p class="more">and {cards.length - closedShown} older</p>
              ) : null}
            </details>
          ) : (
            <section key={stage} class="column" aria-label={stage}>
              {head}
              {list}
            </section>
          );
        })}
      </section>
    </>
  );
}

/** A card's title, as the link that the whole card is the target of. */
function CardTitle({ href, children }: { href: string; children: string }) {
  return (
    <h3 class="card-title">
      <a href={href} class="card-link">
        {children}
      </a>
    </h3>
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
      <div class="card-top">
        <span class="ref">{item.ref}</span>
        {item.level ? (
          <span class="level" title="Autonomy level">
            {item.level}
          </span>
        ) : null}
      </div>
      <CardTitle href={detailHash(item.ref)}>{item.title}</CardTitle>
      {item.hold || item.class ? (
        <div class="row meta">
          {item.hold ? <Badge tone={toneOf("hold", item.hold)}>{item.hold}</Badge> : null}
          {item.class ? <span>{item.class}</span> : null}
        </div>
      ) : null}
      {own.length > 0 ? (
        <div class="tally">
          <span>
            {done}/{own.length} tasks{held > 0 ? `, ${held} held` : ""}
          </span>
          <progress value={done} max={own.length} aria-hidden="true" />
        </div>
      ) : null}
      {up !== undefined || down !== undefined ? (
        <div class="row reorder">
          <button
            type="button"
            class="ghost icon-button"
            aria-label={`Move ${item.ref} up`}
            disabled={up === undefined}
            onClick={() => up !== undefined && move(up)}
          >
            <Icon name="arrow-up" />
          </button>
          <button
            type="button"
            class="ghost icon-button"
            aria-label={`Move ${item.ref} down`}
            disabled={down === undefined}
            onClick={() => down !== undefined && move(down)}
          >
            <Icon name="arrow-down" />
          </button>
        </div>
      ) : null}
    </article>
  );
}

function TaskCard({ task }: { task: TaskRow }) {
  return (
    <article class="card board-card">
      <div class="card-top">
        <span class="ref">{task.ref}</span>
      </div>
      <CardTitle href={detailHash(task.ref)}>{task.goal}</CardTitle>
      {task.hold || task.revisions > 0 ? (
        <div class="row meta">
          {task.hold ? <Badge tone={toneOf("hold", task.hold)}>{task.hold}</Badge> : null}
          {task.revisions > 0 ? (
            <span>
              {task.revisions} {task.revisions === 1 ? "revision" : "revisions"}
            </span>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
