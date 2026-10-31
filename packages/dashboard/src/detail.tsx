import type { Event } from "@kozo/core";
import type { ComponentChildren } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import {
  type Action,
  ActionButton,
  busyAttributes,
  cancelAction,
  inboxActions,
  retryAction,
  takeAction,
} from "./actions.tsx";
import { type Api, ApiError } from "./api.ts";
import { Badge } from "./badge.tsx";
import { detailHash, eventLine, isClosedStage, kindOf, usd } from "./format.ts";
import { Icon, toneIcon } from "./icons.tsx";
import { Loading, Placeholder } from "./placeholder.tsx";
import { items } from "./store.ts";
import { Time } from "./time.tsx";
import { toneOf } from "./tone.ts";

type Row = Record<string, unknown>;

interface PlanTask {
  id: string;
  goal: string;
  done_when: string[];
  scope: string[];
  depends_on: string[];
  characterize?: boolean;
  codemod?: string;
}

interface Plan {
  class: string;
  risk: string;
  approach: string;
  done_when: string[];
  tasks: PlanTask[];
}

interface Detail {
  kind: "item" | "task" | "run";
  item?: Row & { plan: Plan | null; draft: Plan | null };
  task?: Row & { done_when: string[]; scope: string[]; depends_on: string[] };
  tasks?: Row[];
  run?: Row;
  runs?: Row[];
  events?: number;
  cost_usd?: number;
}

interface Verdicts {
  report: { run: string; report: Row & { changes: string[]; out_of_scope: Row[] } } | null;
  review: { run: string; verdict: Row & { findings: Row[] } } | null;
  verify: {
    run: string;
    verdict: Row & { conditions: (Row & { evidence: string[] })[] };
  } | null;
  decisions: { run: string; text: string }[];
  nodes: { node: string; state: string; summary: string | null }[];
  latest: string | null;
  costUsd: number;
}

/**
 * The verbs the detail view offers for a reference in its present state: an approval offers what
 * the inbox does, and closed work or a run that ended offers none.
 */
export function detailActions(
  kind: "item" | "task" | "run",
  hold: string | null,
  approval: "start" | "plan" | null = null,
  ended = false,
): Action[] {
  if (ended) return [];
  if (kind !== "run" && hold === "approval") return inboxActions(kind, "approval", approval);
  const say: Action = {
    verb: "say",
    label: hold === "question" ? "Answer" : "Send",
    text: {
      field: "text",
      required: true,
      placeholder: hold === "question" ? "Your answer" : "An instruction for the next turn or run",
    },
  };
  const pause: Action =
    hold === "paused"
      ? { verb: "resume", label: "Resume" }
      : { verb: "pause", label: "Pause", body: { now: true } };
  if (kind === "run") return [say, pause];
  if (kind === "task" && hold === "taken") {
    return [
      {
        verb: "return",
        label: "Give it back",
        text: { field: "text", required: true, placeholder: "What you changed and checked" },
      },
      cancelAction,
    ];
  }
  return [
    say,
    ...(hold === "attention" || hold === "question" ? [retryAction] : []),
    ...(hold === null || hold === "paused" ? [pause] : []),
    ...(kind === "task" && (hold === null || hold === "attention" || hold === "question")
      ? [takeAction]
      : []),
    cancelAction,
  ];
}

const text = (value: unknown) => (value === null || value === undefined ? "" : String(value));

/** One item, task or run: what it is, what it did and what the human can do about it. */
export function DetailView({ api, refName }: { api: Api; refName: string }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [failed, setFailed] = useState<{ message: string; missing: boolean } | null>(null);
  const [records, setRecords] = useState<Verdicts | null>(null);
  const kind = kindOf(refName);

  useEffect(() => {
    let live = true;
    const load = () =>
      api
        .get<Detail>(`/api/refs/${encodeURIComponent(refName)}`)
        .then((next) => {
          if (live) {
            setDetail(next);
            setFailed(null);
          }
        })
        .catch(
          (error: Error) =>
            live &&
            setFailed({
              message: error.message,
              missing: error instanceof ApiError && error.status === 404,
            }),
        );
    void load();
    const timer = setInterval(load, 3000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [api, refName]);

  // A task's records change when a run ends or its stage or hold moves, not on every poll.
  const shown = detail !== null;
  const runCount = detail?.runs?.length ?? 0;
  useEffect(() => {
    if (kind !== "task" || !shown) return;
    void api
      .get<Verdicts>(`/api/refs/${encodeURIComponent(refName)}/records`)
      .then(setRecords)
      .catch(() => {});
  }, [api, refName, kind, shown, runCount, detail?.task?.stage, detail?.task?.hold]);

  if (failed?.missing) return <Missing refName={refName} />;
  if (failed && !detail) return <p class="problem">{failed.message}</p>;
  if (!detail) {
    return (
      <article class="detail">
        <Loading what={refName} />
        <div class="detail-head">
          <Placeholder />
        </div>
        <div class="detail-main">
          <div class="card">
            <Placeholder lines={4} />
          </div>
          <div class="card">
            <Placeholder lines={4} />
          </div>
        </div>
      </article>
    );
  }
  const subject = (
    detail.item && kind === "item" ? detail.item : (detail.task ?? detail.run)
  ) as Row;
  const hold = (subject.hold as string | null) ?? null;
  const reason = (subject.hold_reason as string | null) ?? null;
  const approval = (subject.hold_approval as "start" | "plan" | null) ?? null;
  const stage = text(subject.shown_stage ?? subject.stage ?? subject.state);
  const actions = detailActions(
    kind,
    hold,
    approval,
    kind === "run" ? stage !== "running" : isClosedStage(stage),
  );
  return (
    <article class="detail">
      <header class="detail-head">
        <Trail kind={kind} refName={refName} subject={subject} />
        <h1>{text(subject.title ?? subject.goal ?? `${text(subject.agent)} run`)}</h1>
        <div class="row">
          <Badge tone={toneOf(kind === "run" ? "run" : "stage", stage)}>{stage}</Badge>
          {hold ? (
            <Badge tone={toneOf("hold", hold)}>
              {hold === "approval" && approval ? `${approval} approval` : hold}
            </Badge>
          ) : null}
          {reason && hold !== "approval" ? <span class="reason">{reason}</span> : null}
        </div>
        {actions.length > 0 ? (
          <div class="row actions">
            {actions.map((action) => (
              <ActionButton key={action.label} api={api} refName={refName} action={action} />
            ))}
          </div>
        ) : null}
      </header>
      <div class="detail-body">
        <div class="detail-main">
          {kind === "item" && detail.item ? (
            <ItemBody item={detail.item} tasks={detail.tasks ?? []} />
          ) : null}
          {kind === "task" && detail.task ? (
            <TaskBody api={api} refName={refName} task={detail.task} records={records} />
          ) : null}
          <Timeline api={api} refName={refName} />
        </div>
        <Properties kind={kind} refName={refName} detail={detail} records={records} />
      </div>
    </article>
  );
}

/** What a reference that does not exist shows, with the ways back. */
function Missing({ refName }: { refName: string }) {
  return (
    <div class="panel empty-state">
      <Icon name="question" />
      <div>
        <h1>{refName} does not exist</h1>
        <p>There is no item, task or run by that reference.</p>
        <p class="row">
          <a class="button-link" href="#/">
            Go to the inbox
          </a>
          <a class="button-link" href="#/board">
            Go to the board
          </a>
        </p>
      </div>
    </div>
  );
}

/** Where a reference sits: its item, its task and its run, the last one the page itself. */
function Trail({
  kind,
  refName,
  subject,
}: {
  kind: "item" | "task" | "run";
  refName: string;
  subject: Row;
}) {
  const trail = [
    kind === "item" ? refName : text(subject.item),
    kind === "task" ? refName : kind === "run" ? text(subject.task) : "",
    kind === "run" ? refName : "",
  ].filter((ref) => ref !== "");
  return (
    <nav aria-label="Breadcrumb">
      <ol class="trail">
        {trail.map((ref) => (
          <li key={ref}>
            {ref === refName ? (
              <span class="ref" aria-current="page">
                {ref}
              </span>
            ) : (
              <a class="ref" href={detailHash(ref)}>
                {ref}
              </a>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** What a reference is, beside what it did: on wide screens a side panel, else under it. */
function Properties({
  kind,
  refName,
  detail,
  records,
}: {
  kind: "item" | "task" | "run";
  refName: string;
  detail: Detail;
  records: Verdicts | null;
}) {
  const rows: [string, ComponentChildren][] = [];
  if (kind === "item" && detail.item) {
    const item = detail.item;
    const shape = item.plan ?? item.draft;
    const level = items.value.find((row) => row.ref === refName)?.level;
    rows.push(["Repository", <code key="repository">{text(item.repository)}</code>]);
    if (shape) rows.push(["Class", shape.class], ["Risk", shape.risk]);
    if (level) rows.push(["Level", level]);
  }
  if (kind === "task" && detail.task) {
    const task = detail.task;
    rows.push(["Revisions", text(task.revisions)]);
    rows.push([
      "Scope",
      <ul key="scope" class="plain">
        {task.scope.map((path) => (
          <li key={path}>
            <code>{path}</code>
          </li>
        ))}
      </ul>,
    ]);
    if (task.depends_on.length > 0) rows.push(["After", task.depends_on.join(", ")]);
  }
  if (kind === "run" && detail.run) {
    const run = detail.run;
    rows.push(["Agent", text(run.agent)], ["Model", <code key="model">{text(run.model)}</code>]);
    rows.push(["Started", <Time key="started" iso={text(run.started_at)} />]);
    if (run.ended_at) rows.push(["Ended", <Time key="ended" iso={text(run.ended_at)} />]);
    rows.push(["Events", text(detail.events)]);
  }
  const cost = detail.cost_usd ?? records?.costUsd;
  if (cost !== undefined) rows.push(["Cost", usd(cost)]);
  return (
    <aside class="properties" aria-label="Properties">
      <dl>
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {detail.runs && detail.runs.length > 0 ? <Runs runs={detail.runs} /> : null}
    </aside>
  );
}

function PlanView({ plan, title }: { plan: Plan; title: string }) {
  return (
    <section class="card">
      <h2>{title}</h2>
      <p>{plan.approach}</p>
      <h3>Done when</h3>
      <ul>
        {plan.done_when.map((condition) => (
          <li key={condition}>{condition}</li>
        ))}
      </ul>
      <h3>Tasks</h3>
      <ol>
        {plan.tasks.map((task) => (
          <li key={task.id}>
            <span class="ref">{task.id}</span> {task.goal}
            {task.characterize ? <span class="meta"> characterizes first</span> : null}
            {task.depends_on.length > 0 ? (
              <span class="meta"> after {task.depends_on.join(", ")}</span>
            ) : null}
            {task.codemod ? (
              <p class="meta">
                codemod: <code>{task.codemod}</code>
              </p>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}

function ItemBody({ item, tasks }: { item: NonNullable<Detail["item"]>; tasks: Row[] }) {
  return (
    <>
      {item.draft ? <PlanView plan={item.draft} title="Draft plan waiting for approval" /> : null}
      {item.plan ? <PlanView plan={item.plan} title="Plan" /> : null}
      {tasks.length > 0 ? (
        <section class="card">
          <h2>Tasks</h2>
          <ul class="plain">
            {tasks.map((task) => (
              <li key={text(task.ref)} class="list-row">
                <a href={detailHash(text(task.ref))} class="list-title">
                  {text(task.goal)}
                </a>
                <span class="ref">{text(task.ref)}</span>
                <Badge tone={toneOf("stage", text(task.stage))}>{text(task.stage)}</Badge>
                {task.hold ? (
                  <Badge tone={toneOf("hold", text(task.hold))}>{text(task.hold)}</Badge>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}

function TaskBody({
  api,
  refName,
  task,
  records,
}: {
  api: Api;
  refName: string;
  task: NonNullable<Detail["task"]>;
  records: Verdicts | null;
}) {
  return (
    <>
      <section class="card">
        <h2>Done when</h2>
        <ul>
          {task.done_when.map((condition) => (
            <li key={condition}>{condition}</li>
          ))}
        </ul>
      </section>
      {records ? <Blueprint records={records} /> : null}
      {records?.report ? (
        <section class="card">
          <RecordHead title="Run report" run={records.report.run} />
          <p>{text(records.report.report.summary)}</p>
          <ul>
            {records.report.report.changes.map((change) => (
              <li key={change}>{change}</li>
            ))}
          </ul>
          {records.report.report.out_of_scope.length > 0 ? (
            <>
              <h3>Noticed out of scope</h3>
              <ul>
                {records.report.report.out_of_scope.map((note) => (
                  <li key={text(note.note)}>
                    {note.path ? <code>{text(note.path)}</code> : null} {text(note.note)}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </section>
      ) : null}
      {records?.review ? (
        <section class="card">
          <RecordHead
            title="Review"
            run={records.review.run}
            verdict={text(records.review.verdict.verdict)}
            tone={toneOf("review", text(records.review.verdict.verdict))}
          />
          <p>{text(records.review.verdict.summary)}</p>
          {records.review.verdict.findings.length > 0 ? (
            <ul class="plain findings">
              {records.review.verdict.findings.map((finding) => (
                <li key={`${text(finding.criterion)} ${text(finding.issue)}`}>
                  <Badge tone={toneOf("severity", text(finding.severity))}>
                    {text(finding.severity)}
                  </Badge>
                  <span>
                    <strong>{text(finding.criterion)}</strong> {text(finding.issue)}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}
      {records?.verify ? (
        <section class="card">
          <RecordHead
            title="Verify"
            run={records.verify.run}
            verdict={text(records.verify.verdict.result)}
            tone={toneOf("verify", text(records.verify.verdict.result))}
          />
          <p>{text(records.verify.verdict.summary)}</p>
          <ul class="plain conditions">
            {records.verify.verdict.conditions.map((condition) => (
              <li key={text(condition.condition)} class={condition.met ? "positive" : "negative"}>
                <Icon name={condition.met ? "check" : "x"} />
                <div>
                  <p>
                    <span class="sr-only">{condition.met ? "Met: " : "Not met: "}</span>
                    {text(condition.condition)}
                  </p>
                  <p class="meta">{text(condition.observation)}</p>
                  {condition.evidence.length > 0 ? (
                    <div class="evidence">
                      {condition.evidence.map((path) => (
                        <Evidence
                          key={path}
                          api={api}
                          run={records.verify?.run ?? ""}
                          path={path}
                        />
                      ))}
                    </div>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {records && records.decisions.length > 0 ? (
        <section class="card">
          <h2>Decision log</h2>
          {records.decisions.map((log) => (
            <div key={log.run}>
              <h3 class="ref">{log.run}</h3>
              <pre class="text">{log.text}</pre>
            </div>
          ))}
        </section>
      ) : null}
      <Diff api={api} refName={refName} />
    </>
  );
}

/** A record's heading: what it is, its verdict as a badge, and the run that made it. */
function RecordHead({
  title,
  run,
  verdict,
  tone,
}: {
  title: string;
  run: string;
  verdict?: string;
  tone?: ReturnType<typeof toneOf>;
}) {
  return (
    <div class="record-head">
      <h2>{title}</h2>
      {verdict && tone ? <Badge tone={tone}>{verdict}</Badge> : null}
      <a class="ref" href={detailHash(run)}>
        {run}
      </a>
    </div>
  );
}

/** The latest run's blueprint as steps, each with its state in words as well as colour. */
function Blueprint({ records }: { records: Verdicts }) {
  return (
    <section class="card">
      <h2>Blueprint{records.latest ? <span class="meta"> in {records.latest}</span> : null}</h2>
      <ol class="steps">
        {records.nodes.map((node) => {
          const tone = toneOf("node", node.state);
          return (
            <li
              key={node.node}
              class={tone}
              aria-current={node.state === "running" ? "step" : undefined}
            >
              <span class="step-mark">
                <Icon name={toneIcon[tone]} size={12} />
              </span>
              <span class="step-name">{node.node}</span>
              <span class="step-state">{node.state}</span>
              {node.summary ? <span class="step-summary">{node.summary}</span> : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** The task branch's diff, read when the human asks for it. */
function Diff({ api, refName }: { api: Api; refName: string }) {
  const [diff, setDiff] = useState<{ diff: string; cut: boolean } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const shown = useRef<HTMLDivElement>(null);
  // The diff replaces the button that asked for it, so focus moves onto the diff.
  useEffect(() => {
    if (diff) shown.current?.focus();
  }, [diff]);
  const show = () => {
    if (loading) return;
    setLoading(true);
    void api
      .get<{ diff: string; cut: boolean }>(`/api/refs/${encodeURIComponent(refName)}/diff`)
      .then((next) => {
        setDiff(next);
        setProblem(null);
      })
      .catch((error: Error) => setProblem(error.message))
      .finally(() => setLoading(false));
  };
  return (
    <section class="card">
      <h2>Diff</h2>
      {diff ? (
        <div ref={shown} class="diff-shown" tabIndex={-1}>
          <DiffView text={diff.diff} />
          {diff.cut ? (
            <p class="meta">The diff is longer; kozo show --diff prints all of it.</p>
          ) : null}
        </div>
      ) : (
        <button type="button" onClick={show} {...busyAttributes(loading)}>
          {loading ? "Reading the diff…" : "Show the diff"}
        </button>
      )}
      {problem ? <p class="problem">{problem}</p> : null}
    </section>
  );
}

/** A diff as text, its added and removed lines marked; it is never rendered as markup. */
function DiffView({ text }: { text: string }) {
  // The detail view re-renders on every poll, and a diff runs to many thousand lines.
  const lines = useMemo(
    () =>
      text.split("\n").map((line, index) => {
        const kind =
          line.startsWith("diff ") || line.startsWith("+++") || line.startsWith("---")
            ? "file"
            : line.startsWith("+")
              ? "add"
              : line.startsWith("-")
                ? "del"
                : line.startsWith("@@")
                  ? "hunk"
                  : "";
        return (
          <span key={index} class={kind}>
            {line}
            {"\n"}
          </span>
        );
      }),
    [text],
  );
  if (text.trim() === "") return <p class="empty">The branch changes nothing yet.</p>;
  return <pre class="diff">{lines}</pre>;
}

/** One evidence file: an image shown in place, anything else as a download. */
function Evidence({ api, run, path }: { api: Api; run: string; path: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [image, setImage] = useState(false);
  useEffect(() => {
    let made: string | null = null;
    void api
      .blob(`/api/runs/${run}/evidence/${path.split("/").map(encodeURIComponent).join("/")}`)
      .then((blob) => {
        made = URL.createObjectURL(blob);
        setImage(blob.type.startsWith("image/"));
        setUrl(made);
      })
      .catch(() => {});
    return () => {
      if (made) URL.revokeObjectURL(made);
    };
  }, [api, run, path]);
  if (!url) return <span class="evidence-file">{path}</span>;
  return image ? (
    <a href={url} target="_blank" rel="noreferrer" class="evidence-image">
      <img src={url} alt={`evidence ${path}`} />
    </a>
  ) : (
    <a href={url} download={path.split("/").at(-1)} class="evidence-file">
      {path}
    </a>
  );
}

function Runs({ runs }: { runs: Row[] }) {
  return (
    <section>
      <h2>Runs</h2>
      <ul class="plain runs">
        {runs.map((run) => (
          <li key={text(run.ref)}>
            <a href={detailHash(text(run.ref))} class="ref">
              {text(run.ref)}
            </a>
            <span>{text(run.agent)}</span>
            <Badge tone={toneOf("run", text(run.state))}>{text(run.state)}</Badge>
            <Time iso={text(run.started_at)} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The newest events first, in one group per run, so a run's turns read together. It follows the
 * events itself, so that each one re-renders the timeline only and not the whole view.
 */
function Timeline({ api, refName }: { api: Api; refName: string }) {
  const [events, setEvents] = useState<Event[]>([]);
  useEffect(() => {
    const stop = new AbortController();
    void api
      .follow(
        refName,
        (event) => setEvents((shown) => [event, ...shown].slice(0, 400)),
        stop.signal,
      )
      .catch(() => {});
    return () => stop.abort();
  }, [api, refName]);
  const groups = useMemo(() => {
    const grouped: { run: string | null; events: Event[] }[] = [];
    for (const event of events) {
      const run = event.run_id ?? null;
      const last = grouped.at(-1);
      if (last && last.run === run) last.events.push(event);
      else grouped.push({ run, events: [event] });
    }
    return grouped;
  }, [events]);
  return (
    <section class="card">
      <h2>Events</h2>
      {events.length === 0 ? <p class="empty">No events yet.</p> : null}
      <div class="timeline">
        {groups.map((group) => (
          <div key={`${group.run} ${group.events[0]?.ts}`} class="timeline-group">
            <h3 class="ref">{group.run ?? "kozod"}</h3>
            <ol class="plain">
              {group.events.map((event) => (
                <li key={`${event.ts} ${event.seq} ${event.run_id ?? ""}`}>
                  <Time iso={event.ts} as="clock" />
                  <code class="event-type">{event.type}</code>
                  <span class="line">
                    {event.node ? <span class="meta">{event.node} </span> : null}
                    {eventLine(event as { type: string; data: Record<string, unknown> })}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        ))}
      </div>
    </section>
  );
}
