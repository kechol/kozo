import type { Event } from "@kozo/core";
import { useEffect, useState } from "preact/hooks";
import { type Action, ActionButton, cancelAction, retryAction, takeAction } from "./actions.tsx";
import type { Api } from "./api.ts";
import { ago, detailHash, eventLine, kindOf, usd } from "./format.ts";

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

// The text kozo take puts on the hold it sets, which kozo return alone clears.
const takenReason = "the human took it; kozo return gives it back";

/** The verbs the detail view offers for a reference in its present state. */
export function detailActions(
  kind: "item" | "task" | "run",
  hold: string | null,
  reason: string | null,
): Action[] {
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
  const taken = hold === "paused" && reason === takenReason;
  if (kind === "task" && taken) {
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

/** One item, task or run: what it is, what it did and what the human can do about it. */
export function DetailView({ api, refName }: { api: Api; refName: string }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [events, setEvents] = useState<Event[]>([]);
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
        .catch((error: Error) => live && setFailed(error.message));
    void load();
    const timer = setInterval(load, 3000);
    const stop = new AbortController();
    setEvents([]);
    void api
      .follow(
        refName,
        (event) => setEvents((shown) => [event, ...shown].slice(0, 400)),
        stop.signal,
      )
      .catch(() => {});
    return () => {
      live = false;
      clearInterval(timer);
      stop.abort();
    };
  }, [api, refName]);

  if (failed && !detail) return <p class="problem">{failed}</p>;
  if (!detail) return <p class="empty">Loading {refName}…</p>;
  const subject = (
    detail.item && kind === "item" ? detail.item : (detail.task ?? detail.run)
  ) as Row;
  const hold = (subject.hold as string | null) ?? null;
  const reason = (subject.hold_reason as string | null) ?? null;
  return (
    <article class="detail">
      <header class="detail-head">
        <p class="ref">{refName}</p>
        <h2>{String(subject.title ?? subject.goal ?? `${subject.agent} run`)}</h2>
        <p class="row meta">
          <span>{String(subject.shown_stage ?? subject.stage ?? subject.state)}</span>
          {hold ? <span class={`badge ${hold}`}>{hold}</span> : null}
          {reason ? <span class="reason">{reason}</span> : null}
          {detail.cost_usd !== undefined ? <span>cost {usd(detail.cost_usd)}</span> : null}
        </p>
        <div class="row actions">
          {detailActions(kind, hold, reason).map((action) => (
            <ActionButton key={action.label} api={api} refName={refName} action={action} />
          ))}
        </div>
      </header>
      {kind === "item" && detail.item ? <ItemBody detail={detail} /> : null}
      {kind === "task" && detail.task ? (
        <TaskBody api={api} refName={refName} detail={detail} />
      ) : null}
      {detail.runs && detail.runs.length > 0 ? <Runs runs={detail.runs} /> : null}
      <Timeline events={events} />
    </article>
  );
}

function PlanView({ plan, title }: { plan: Plan; title: string }) {
  return (
    <section class="card">
      <h3>{title}</h3>
      <p class="meta">
        {plan.class}, {plan.risk} risk
      </p>
      <p>{plan.approach}</p>
      <ul>
        {plan.done_when.map((condition) => (
          <li key={condition}>{condition}</li>
        ))}
      </ul>
      <ol class="plan-tasks">
        {plan.tasks.map((task) => (
          <li key={task.id}>
            <strong>{task.id}</strong> {task.goal}
            {task.characterize ? <span class="meta"> (characterizes)</span> : null}
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

function ItemBody({ detail }: { detail: Detail }) {
  const item = detail.item;
  if (!item) return null;
  return (
    <>
      {item.draft ? <PlanView plan={item.draft} title="Draft waiting for approval" /> : null}
      {item.plan ? <PlanView plan={item.plan} title="Plan" /> : null}
      {detail.tasks && detail.tasks.length > 0 ? (
        <section class="card">
          <h3>Tasks</h3>
          <ul class="plain">
            {detail.tasks.map((task) => (
              <li key={String(task.ref)} class="row">
                <a href={detailHash(String(task.ref))} class="ref">
                  {String(task.ref)}
                </a>
                <span class="meta">{String(task.stage)}</span>
                {task.hold ? <span class={`badge ${task.hold}`}>{String(task.hold)}</span> : null}
                <span>{String(task.goal)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}

function TaskBody({ api, refName, detail }: { api: Api; refName: string; detail: Detail }) {
  const task = detail.task;
  const [records, setRecords] = useState<Verdicts | null>(null);
  const [diff, setDiff] = useState<{ diff: string; cut: boolean } | null>(null);
  const [diffProblem, setDiffProblem] = useState<string | null>(null);
  const runCount = detail.runs?.length ?? 0;
  useEffect(() => {
    void api
      .get<Verdicts>(`/api/refs/${encodeURIComponent(refName)}/records`)
      .then(setRecords)
      .catch(() => {});
  }, [api, refName, runCount, task?.stage, task?.hold]);
  if (!task) return null;
  const showDiff = () =>
    void api
      .get<{ diff: string; cut: boolean }>(`/api/refs/${encodeURIComponent(refName)}/diff`)
      .then((next) => {
        setDiff(next);
        setDiffProblem(null);
      })
      .catch((error: Error) => setDiffProblem(error.message));
  return (
    <>
      <section class="card">
        <h3>Done when</h3>
        <ul>
          {task.done_when.map((condition) => (
            <li key={condition}>{condition}</li>
          ))}
        </ul>
        <p class="meta">scope: {task.scope.join(", ")}</p>
        {records ? <p class="meta">cost {usd(records.costUsd)}</p> : null}
      </section>
      {records ? (
        <section class="card">
          <h3>Blueprint{records.latest ? ` in ${records.latest}` : ""}</h3>
          <ol class="nodes">
            {records.nodes.map((node) => (
              <li key={node.node} class={`node ${node.state}`} title={node.summary ?? node.state}>
                {node.node}
              </li>
            ))}
          </ol>
        </section>
      ) : null}
      {records?.report ? (
        <section class="card">
          <h3>Run report of {records.report.run}</h3>
          <p>{String(records.report.report.summary)}</p>
          <ul>
            {records.report.report.changes.map((change) => (
              <li key={change}>{change}</li>
            ))}
          </ul>
          {records.report.report.out_of_scope.length > 0 ? (
            <>
              <p class="meta">Noticed out of scope:</p>
              <ul>
                {records.report.report.out_of_scope.map((note) => (
                  <li key={String(note.note)}>
                    {note.path ? <code>{String(note.path)}</code> : null} {String(note.note)}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </section>
      ) : null}
      {records?.review ? (
        <section class="card">
          <h3>
            Review: {String(records.review.verdict.verdict)}{" "}
            <span class="meta">in {records.review.run}</span>
          </h3>
          <p>{String(records.review.verdict.summary)}</p>
          <ul>
            {records.review.verdict.findings.map((finding) => (
              <li key={`${finding.criterion} ${finding.issue}`}>
                <span class="meta">{String(finding.severity)}</span> {String(finding.criterion)}:{" "}
                {String(finding.issue)}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {records?.verify ? (
        <section class="card">
          <h3>
            Verify: {String(records.verify.verdict.result)}{" "}
            <span class="meta">in {records.verify.run}</span>
          </h3>
          <p>{String(records.verify.verdict.summary)}</p>
          <ul class="plain">
            {records.verify.verdict.conditions.map((condition) => (
              <li key={String(condition.condition)} class="condition">
                <p>
                  <span class={condition.met ? "met" : "unmet"}>
                    {condition.met ? "met" : "not met"}
                  </span>{" "}
                  {String(condition.condition)}
                </p>
                <p class="meta">{String(condition.observation)}</p>
                <div class="evidence">
                  {condition.evidence.map((path) => (
                    <Evidence key={path} api={api} run={records.verify?.run ?? ""} path={path} />
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {records && records.decisions.length > 0 ? (
        <section class="card">
          <h3>Decision log</h3>
          {records.decisions.map((log) => (
            <div key={log.run}>
              <p class="meta">{log.run}</p>
              <pre class="text">{log.text}</pre>
            </div>
          ))}
        </section>
      ) : null}
      <section class="card">
        <h3>Diff</h3>
        {diff ? (
          <>
            <DiffView text={diff.diff} />
            {diff.cut ? (
              <p class="meta">The diff is longer; kozo show --diff prints all of it.</p>
            ) : null}
          </>
        ) : (
          <button type="button" class="quiet" onClick={showDiff}>
            Show the diff
          </button>
        )}
        {diffProblem ? <p class="problem">{diffProblem}</p> : null}
      </section>
    </>
  );
}

/** A diff as text, its added and removed lines marked; it is never rendered as markup. */
function DiffView({ text }: { text: string }) {
  if (text.trim() === "") return <p class="empty">The branch changes nothing yet.</p>;
  return (
    <pre class="diff">
      {text.split("\n").map((line, index) => {
        const kind =
          line.startsWith("+++") || line.startsWith("---")
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
      })}
    </pre>
  );
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
  if (!url) return <span class="meta">{path}</span>;
  return image ? (
    <a href={url} target="_blank" rel="noreferrer">
      <img src={url} alt={`evidence ${path}`} />
    </a>
  ) : (
    <a href={url} download={path.split("/").at(-1)}>
      {path}
    </a>
  );
}

function Runs({ runs }: { runs: Row[] }) {
  return (
    <section class="card">
      <h3>Runs</h3>
      <ul class="plain">
        {runs.map((run) => (
          <li key={String(run.ref)} class="row">
            <a href={detailHash(String(run.ref))} class="ref">
              {String(run.ref)}
            </a>
            <span>{String(run.agent)}</span>
            <span class="meta">{String(run.state)}</span>
            <span class="meta">{ago(String(run.started_at))}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Timeline({ events }: { events: Event[] }) {
  return (
    <section class="card">
      <h3>Events</h3>
      {events.length === 0 ? <p class="empty">No events yet.</p> : null}
      <ol class="timeline">
        {events.map((event) => (
          <li key={`${event.ts} ${event.seq} ${event.run_id ?? ""}`}>
            <span class="meta">{new Date(event.ts).toLocaleString()}</span>{" "}
            <code>{event.type}</code>
            {event.node ? <span class="meta"> {event.node}</span> : null}{" "}
            <span class="line">
              {eventLine(event as { type: string; data: Record<string, unknown> })}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
