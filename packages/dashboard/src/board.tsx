import { signal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { AddItem } from "./add-item.tsx";
import type { Api, ItemRow, TaskRow } from "./api.ts";
import { HoldBadge } from "./badge.tsx";
import {
  type BoardView,
  detailHash,
  hashOf,
  isClosedStage,
  moveTarget,
  route,
  stages,
} from "./format.ts";
import { Icon } from "./icons.tsx";
import { Loading, Placeholder, Unread } from "./placeholder.tsx";
import { items, loaded, problem, run, status, tasks } from "./store.ts";
import { toneOf } from "./tone.ts";
import { stageName, t } from "./words.ts";

/**
 * Whether the board shows items or tasks: the viewer's choice, kept in this browser and in the
 * address, so that a link or a bookmark opens the same board.
 */
const view = signal<BoardView>(readView());

function readView(): BoardView {
  try {
    return localStorage.getItem("kozo.board") === "tasks" ? "tasks" : "items";
  } catch {
    return "items";
  }
}

function choose(next: BoardView) {
  view.value = next;
  // Replacing the address fires no hashchange, so the board keeps focus on the switch; the route
  // follows by hand, so that the links the board makes name what it shows. The pane stays open.
  const at = { page: "board", view: next, ref: route.value.ref } as const;
  route.value = at;
  history.replaceState(null, "", hashOf(at));
  try {
    localStorage.setItem("kozo.board", next);
  } catch {}
}

// A closed column keeps its newest cards only; the others are counted.
const closedShown = 10;

/** Items or tasks in one column per stage, with their holds, progress and autonomy level. */
export function Board({ api, asked }: { api: Api; asked?: BoardView }) {
  // The address names what the board shows once it opens, whichever way it was opened.
  useEffect(() => {
    choose(asked ?? view.value);
  }, [asked]);
  const showItems = view.value === "items";
  const allItems = items.value;
  const order = allItems.filter((item) => !isClosedStage(item.stage)).map((item) => item.ref);
  const ready = loaded.value;
  // A factory with one repository need not say which one each card is in.
  const several = (status.value?.repositories.length ?? 0) > 1;
  const repositoryOf = new Map(allItems.map((item) => [item.ref, item.repository]));
  // Each card counts and lists its item's tasks, so they are gathered in one pass rather than
  // per card.
  const tally = new Map<string, Tally>();
  const taskLists = new Map<string, TaskRow[]>();
  for (const task of tasks.value) {
    taskLists.set(task.item, [...(taskLists.get(task.item) ?? []), task]);
    const count = tally.get(task.item) ?? { done: 0, total: 0, held: 0, merge: 0 };
    count.total += 1;
    if (task.stage === "complete") count.done += 1;
    if (task.hold) count.held += 1;
    if (task.awaiting_merge) count.merge += 1;
    tally.set(task.item, count);
  }
  return (
    <>
      <div class="row spread board-tools">
        <fieldset class="segmented">
          <legend class="sr-only">{t("board.show")}</legend>
          <label>
            <input
              type="radio"
              name="board-view"
              checked={showItems}
              onChange={() => choose("items")}
            />
            {t("board.items")}
          </label>
          <label>
            <input
              type="radio"
              name="board-view"
              checked={!showItems}
              onChange={() => choose("tasks")}
            />
            {t("board.tasks")}
          </label>
        </fieldset>
        {status.value?.mode === "local" ? <AddItem api={api} /> : null}
      </div>
      {!ready && problem.value ? (
        <Unread what={t("what.board")} />
      ) : (
        // biome-ignore lint/a11y/noNoninteractiveTabindex: a scroller takes focus so the keyboard can scroll it
        <section class="board" aria-label={t("board.stages")} tabIndex={0}>
          {ready ? null : <Loading what={t("what.board")} />}
          {stages.map((stage) => {
            const cards = showItems
              ? allItems.filter((item) => item.shown_stage === stage)
              : tasks.value.filter((task) => task.stage === stage);
            const closed = isClosedStage(stage);
            const shown = closed ? cards.slice(-closedShown).reverse() : cards;
            const column = cards.map((card) => card.ref);
            const head = (
              <h2>
                {stageName(stage)} {ready ? <span class="column-count">{cards.length}</span> : null}
              </h2>
            );
            const list = shown.map((card, index) =>
              showItems ? (
                <ItemCard
                  key={card.ref}
                  api={api}
                  item={card as ItemRow}
                  tally={tally.get(card.ref)}
                  tasks={taskLists.get(card.ref) ?? []}
                  repository={several ? (card as ItemRow).repository : undefined}
                  up={closed ? undefined : moveTarget(column, order, index, "up")}
                  down={closed ? undefined : moveTarget(column, order, index, "down")}
                />
              ) : (
                <TaskCard
                  key={card.ref}
                  task={card as TaskRow}
                  repository={several ? repositoryOf.get((card as TaskRow).item) : undefined}
                />
              ),
            );
            // A closed column holds what is finished, so it stays folded to its count until opened.
            // An empty column keeps its frame, so the columns line up whatever they hold.
            const body = !ready ? (
              <div class="card board-card">
                <Placeholder />
              </div>
            ) : cards.length === 0 ? (
              <div class="column-empty" aria-hidden="true" />
            ) : (
              list
            );
            return closed ? (
              <details key={stage} class="column closed">
                <summary>{head}</summary>
                {list}
                {cards.length > closedShown ? (
                  <p class="more">{t("board.older", { n: cards.length - closedShown })}</p>
                ) : null}
              </details>
            ) : (
              <section key={stage} class="column" aria-label={stageName(stage)}>
                {head}
                {body}
              </section>
            );
          })}
        </section>
      )}
    </>
  );
}

/** A card's reference, and its repository when the factory has several. */
function Where({ refName, repository }: { refName: string; repository: string | undefined }) {
  return (
    <span>
      <span class="ref">{refName}</span>
      {repository ? t("board.in", { repository }) : null}
    </span>
  );
}

/** A card's title, as the link that the whole card is the target of, marked while it is open. */
function CardTitle({ refName, children }: { refName: string; children: string }) {
  return (
    <h3 class="card-title">
      <a
        href={detailHash(refName)}
        class="card-link"
        aria-current={route.value.ref === refName ? "true" : undefined}
      >
        {children}
      </a>
    </h3>
  );
}

interface Tally {
  done: number;
  total: number;
  held: number;
  merge: number;
}

function ItemCard({
  api,
  item,
  tally,
  tasks,
  repository,
  up,
  down,
}: {
  api: Api;
  item: ItemRow;
  tally: Tally | undefined;
  tasks: TaskRow[];
  repository: string | undefined;
  up: string | null | undefined;
  down: string | null | undefined;
}) {
  const move = (before: string | null) =>
    void run(api, () => api.act(item.ref, "reorder", { before }));
  return (
    <article class="card board-card">
      <div class="card-top">
        <Where refName={item.ref} repository={repository} />
        {item.level ? <span title={t("board.autonomy")}>{item.level}</span> : null}
      </div>
      <CardTitle refName={item.ref}>{item.title}</CardTitle>
      {item.hold || item.class ? (
        <div class="row meta">
          {item.hold ? <HoldBadge hold={item.hold} /> : null}
          {item.class ? <span>{item.class}</span> : null}
        </div>
      ) : null}
      {tally ? (
        <div class="tally">
          <span>
            {t("board.tally", { done: tally.done, total: tally.total })}
            {tally.held > 0 ? t("board.tallyHeld", { n: tally.held }) : ""}
            {tally.merge > 0 ? t("board.tallyMerge", { n: tally.merge }) : ""}
          </span>
          <progress value={tally.done} max={tally.total} aria-hidden="true" />
        </div>
      ) : null}
      {tasks.length > 0 ? <CardTasks tasks={tasks} /> : null}
      {up !== undefined || down !== undefined ? (
        <div class="row reorder">
          <button
            type="button"
            class="ghost icon-button"
            aria-label={t("board.moveUp", { ref: item.ref })}
            disabled={up === undefined}
            onClick={() => up !== undefined && move(up)}
          >
            <Icon name="arrow-up" />
          </button>
          <button
            type="button"
            class="ghost icon-button"
            aria-label={t("board.moveDown", { ref: item.ref })}
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

/**
 * An item's tasks on its card, each opening in the pane: its number and goal, then its hold, its
 * wait for a merge or else its stage, so the board need not switch to tasks to show how each goes.
 */
function CardTasks({ tasks }: { tasks: TaskRow[] }) {
  const open = route.value.ref;
  return (
    <ul class="card-tasks">
      {tasks.map((task) => (
        <li key={task.ref}>
          <a
            href={detailHash(task.ref)}
            class="card-task"
            title={task.goal}
            aria-current={task.ref === open ? "true" : undefined}
          >
            <span class="ref">{task.ref.slice(task.ref.lastIndexOf("/") + 1)}</span>
            <span class="card-task-goal">{task.goal}</span>
          </a>
          {task.hold ? (
            <HoldBadge hold={task.hold} />
          ) : task.awaiting_merge ? (
            <HoldBadge hold="merge" />
          ) : (
            <span class={`card-task-stage ${toneOf("stage", task.stage)}`}>
              {stageName(task.stage)}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

function TaskCard({ task, repository }: { task: TaskRow; repository: string | undefined }) {
  return (
    <article class="card board-card">
      <div class="card-top">
        <Where refName={task.ref} repository={repository} />
      </div>
      <CardTitle refName={task.ref}>{task.goal}</CardTitle>
      {task.hold || task.awaiting_merge || task.revisions > 0 ? (
        <div class="row meta">
          {task.hold ? <HoldBadge hold={task.hold} /> : null}
          {task.awaiting_merge ? <HoldBadge hold="merge" /> : null}
          {task.revisions > 0 ? (
            <span>
              {t(task.revisions === 1 ? "board.revisionsOne" : "board.revisionsOther", {
                n: task.revisions,
              })}
            </span>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
