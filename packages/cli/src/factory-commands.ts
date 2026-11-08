import { spawn } from "node:child_process";
import { mkdir, open, readdir } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  factoryTemplate,
  type KozoHome,
  kozoHome,
  listKindSchema,
  message,
  type Plan,
  parseReference,
  render,
  type Verb,
  verbsByKind,
  workClassSchema,
} from "@kozo/core";
import {
  definitionTip,
  GitError,
  git,
  installRepositoryTemplate,
  readDefinition,
} from "@kozo/verify";
import {
  type Answer,
  apiPortFromEnvironment,
  type Client,
  connect,
  KozodUnavailable,
  refPath,
} from "./client.ts";
import { english, type Words } from "./words.ts";

export const ExitCode = {
  success: 0,
  failure: 1,
  usage: 2,
  awaitingHuman: 3,
  notFound: 4,
} as const;

export interface Lines {
  stdout(line: string): void;
  stderr(line: string): void;
}

/** A usage error found after the arguments parsed. */
export class UsageError extends Error {}

/**
 * Text from kozod can carry what an agent or a request wrote, so control characters, escape
 * sequences included, are removed before it reaches a terminal; tabs stay.
 */
export function printable(text: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: matching them is the point.
  return text.replace(/[\u0000-\u0008\u000a-\u001f\u007f-\u009f]/g, "");
}

/** Maps an API answer to the CLI's exit code: 400 is a usage error and 404 is not found. */
function exitFor(answer: Answer): number {
  if (answer.status === 404) return ExitCode.notFound;
  if (answer.status === 400) return ExitCode.usage;
  if (answer.status >= 300) return ExitCode.failure;
  return answer.body.awaitingHuman === true ? ExitCode.awaitingHuman : ExitCode.success;
}

function printAnswer(
  out: Lines,
  t: Words,
  json: boolean | undefined,
  answer: Answer,
  text: () => string[],
) {
  if (json) {
    out.stdout(JSON.stringify(answer.body));
  } else if (answer.status >= 300) {
    const error = answer.body.error ?? t("cli.kozod-answered", { status: answer.status });
    out.stderr(`kozo: ${printable(String(error))}`);
    for (const issue of answer.body.issues ?? []) out.stderr(`  ${printable(String(issue))}`);
  } else {
    for (const line of text()) out.stdout(printable(line));
  }
  return exitFor(answer);
}

/** Posts to the local API and prints kozod's message, or the whole answer with --json. */
function postAndPrint(
  out: Lines,
  t: Words,
  json: boolean | undefined,
  path: string,
  body?: unknown,
) {
  return withClient(out, t, async (client) => {
    const answer = await client.post(path, body);
    return printAnswer(out, t, json, answer, () => [String(answer.body.message)]);
  });
}

/** Writes why kozod cannot be reached, in the locale of `t`. */
function unavailable(out: Lines, t: Words, error: KozodUnavailable) {
  out.stderr(`kozo: ${render(error.problem, t.locale)}`);
}

async function withClient(out: Lines, t: Words, work: (client: Client) => Promise<number>) {
  try {
    return await work(await connect());
  } catch (error) {
    if (!(error instanceof KozodUnavailable)) throw error;
    unavailable(out, t, error);
    return ExitCode.failure;
  }
}

const table = (rows: readonly (readonly string[])[]) => {
  const widths = rows.reduce<number[]>(
    (max, row) => row.map((cell, index) => Math.max(max[index] ?? 0, cell.length)),
    [],
  );
  return rows.map((row) =>
    row
      .map((cell, index) => (index === row.length - 1 ? cell : cell.padEnd(widths[index] ?? 0)))
      .join("  ")
      .trimEnd(),
  );
};

type Row = Record<string, string | number | null>;
const cell = (value: unknown) => (value === null || value === undefined ? "-" : String(value));

// --- kozo up / down ---------------------------------------------------------------------------

/** The kozod to start: KOZOD, the kozod beside this executable, or kozod on PATH. */
function kozodCommand(): string[] {
  const named = process.env.KOZOD;
  if (named) return named.endsWith(".ts") ? [process.execPath, named] : [named];
  const sibling = join(dirname(process.execPath), "kozod");
  if (!process.execPath.endsWith("/bun") && Bun.file(sibling).size > 0) return [sibling];
  const onPath = Bun.which("kozod");
  if (onPath) return [onPath];
  throw new KozodUnavailable(message("cli.kozod-not-installed"));
}

async function running(home: KozoHome): Promise<boolean> {
  try {
    const client = await connect(home);
    return (await client.get("/api/status")).status === 200;
  } catch {
    return false;
  }
}

export async function up(args: readonly string[], out: Lines, t = english): Promise<number> {
  const { values } = parseArgs({ args: [...args], options: { json: { type: "boolean" } } });
  const home = kozoHome();
  const url = `http://127.0.0.1:${apiPortFromEnvironment()}`;
  const report = (text: string) => {
    out.stdout(values.json ? JSON.stringify({ url, message: text }) : `${text}: ${url}`);
    return ExitCode.success;
  };
  if (await running(home)) return report(t("cli.kozod-already-running"));
  await mkdir(home.root, { recursive: true, mode: 0o700 });
  const log = await open(join(home.root, "kozod.log"), "a");
  let command: string[];
  try {
    command = kozodCommand();
  } catch (error) {
    if (!(error instanceof KozodUnavailable)) throw error;
    unavailable(out, t, error);
    return ExitCode.failure;
  }
  const child = spawn(command[0] ?? "kozod", command.slice(1), {
    detached: true,
    stdio: ["ignore", log.fd, log.fd],
    env: process.env,
  });
  let exited: number | null = null;
  child.on("exit", (code) => {
    exited = code ?? 1;
  });
  child.unref();
  for (let waited = 0; waited < 15_000; waited += 100) {
    if (exited !== null) break;
    if (await running(home)) {
      await log.close();
      return report(t("cli.kozod-up"));
    }
    await Bun.sleep(100);
  }
  await log.close();
  out.stderr(`kozo: ${t("cli.kozod-not-started", { log: join(home.root, "kozod.log") })}`);
  return ExitCode.failure;
}

/**
 * Whether `pid` is kozod: the kozod answering on the API names it as its own, or, for one that
 * does not answer, the process's executable is kozod.
 */
async function isKozod(pid: number): Promise<boolean> {
  try {
    const client = await connect();
    const status = await client.get("/api/status");
    if (status.body.pid === pid) return true;
  } catch (error) {
    if (!(error instanceof KozodUnavailable)) throw error;
  }
  const ps = Bun.spawnSync(["ps", "-o", "comm=", "-p", String(pid)]);
  return basename(ps.stdout.toString().trim()) === "kozod";
}

export async function down(args: readonly string[], out: Lines, t = english): Promise<number> {
  const { values } = parseArgs({ args: [...args], options: { json: { type: "boolean" } } });
  const home = kozoHome();
  const report = (text: string) => {
    out.stdout(values.json ? JSON.stringify({ message: text }) : text);
    return ExitCode.success;
  };
  const file = Bun.file(home.pidFile);
  if (!(await file.exists())) return report(t("cli.kozod-not-running"));
  const pid = Number((await file.text()).trim());
  // After a crash the pid may be another process's, which must not get the signal.
  if (!(await isKozod(pid))) {
    return report(t("cli.kozod-not-running-pid", { file: home.pidFile, pid }));
  }
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    return report(t("cli.kozod-not-running"));
  }
  for (let waited = 0; waited < 15_000; waited += 100) {
    try {
      process.kill(pid, 0);
    } catch {
      return report(t("cli.kozod-down"));
    }
    await Bun.sleep(100);
  }
  out.stderr(`kozo: ${t("cli.kozod-not-stopped", { pid })}`);
  return ExitCode.failure;
}

// --- kozo dashboard ---------------------------------------------------------------------------

/**
 * Opens the dashboard in the browser with a code that the page trades for a session; with
 * --url, prints that URL instead. The code is good once, for a minute, and lives in the URL's
 * fragment, which the browser never sends to a server.
 */
export async function dashboard(args: readonly string[], out: Lines, t = english): Promise<number> {
  const { values } = parseArgs({
    args: [...args],
    options: { url: { type: "boolean" }, json: { type: "boolean" } },
  });
  return withClient(out, t, async (client) => {
    const answer = await client.post("/api/dashboard/code");
    if (answer.status !== 200) return printAnswer(out, t, values.json, answer, () => []);
    const url = `${client.base}/#code=${String(answer.body.code)}`;
    if (values.url) {
      out.stdout(values.json ? JSON.stringify({ url }) : url);
      return ExitCode.success;
    }
    const opener = process.platform === "darwin" ? "open" : "xdg-open";
    // Bun.spawn throws at once when the opener is not installed.
    const opened = await Promise.resolve()
      .then(() => Bun.spawn([opener, url], { stdin: "ignore", stdout: "ignore", stderr: "ignore" }))
      .then((child) => child.exited)
      .catch(() => 1);
    if (opened !== 0) {
      out.stderr(`kozo: ${t("cli.opener-failed", { opener })}`);
      return ExitCode.failure;
    }
    const text = t("cli.dashboard-opened", { url: `${client.base}/` });
    out.stdout(values.json ? JSON.stringify({ message: text }) : text);
    return ExitCode.success;
  });
}

// --- kozo status ------------------------------------------------------------------------------

export async function status(args: readonly string[], out: Lines, t = english): Promise<number> {
  const { values } = parseArgs({
    args: [...args],
    options: { line: { type: "boolean" }, json: { type: "boolean" } },
  });
  let answer: Answer;
  try {
    answer = await (await connect()).get("/api/status");
  } catch (error) {
    if (!(error instanceof KozodUnavailable)) throw error;
    if (values.line) out.stdout(t("cli.status-down"));
    else if (values.json) out.stdout(JSON.stringify({ running: false }));
    else unavailable(out, t, error);
    return ExitCode.failure;
  }
  const s = answer.body as {
    mode: string;
    paused: boolean;
    pausedReason: string | null;
    activeRuns: number;
    waiting: number;
    costTodayUsd: number;
    reservedUsd: number;
  };
  const today = dollars(s.costTodayUsd);
  const cost =
    s.reservedUsd > 0
      ? t("cli.cost-today-held", { amount: today, held: dollars(s.reservedUsd) })
      : t("cli.cost-today", { amount: today });
  if (values.line) {
    out.stdout(
      t("cli.status-line", {
        state: s.paused ? t("cli.state-paused") : t("cli.state-up"),
        mode: s.mode,
        running: t("cli.count-running", { count: s.activeRuns }),
        waiting: t("cli.count-waiting", { count: s.waiting }),
        cost,
      }),
    );
    return exitFor(answer);
  }
  return printAnswer(
    out,
    t,
    values.json,
    { ...answer, body: { running: true, ...answer.body } },
    () => [
      `kozod     ${s.paused ? t("cli.kozod-state-paused", { reason: String(s.pausedReason) }) : t("cli.kozod-state-running")}`,
      `mode      ${s.mode}`,
      `runs      ${t("cli.count-running", { count: s.activeRuns })}`,
      `waiting   ${t("cli.count-in-inbox", { count: s.waiting })}`,
      `cost      ${cost}`,
    ],
  );
}

// --- kozo add ---------------------------------------------------------------------------------

export async function add(args: readonly string[], out: Lines, t = english): Promise<number> {
  const { values, positionals } = parseArgs({
    args: [...args],
    options: {
      repo: { type: "string" },
      class: { type: "string" },
      file: { type: "string", short: "f" },
      json: { type: "boolean" },
    },
    allowPositionals: true,
  });
  const workClass =
    values.class === undefined ? undefined : workClassSchema.safeParse(values.class);
  if (workClass && !workClass.success)
    throw new UsageError(t("cli.unknown-class", { class: String(values.class) }));
  let text = positionals.join(" ");
  if (values.file) text = `${text}\n${await Bun.file(values.file).text()}`.trim();
  const [title = "", ...rest] = text.trim().split("\n");
  if (title.trim() === "") throw new UsageError(t("cli.add-needs-text"));
  return postAndPrint(out, t, values.json, "/api/items", {
    title: title.trim(),
    body: rest.join("\n").trim() || undefined,
    repository: values.repo,
    class: workClass?.data,
  });
}

// --- kozo ls ----------------------------------------------------------------------------------

export async function ls(args: readonly string[], out: Lines, t = english): Promise<number> {
  const { values, positionals } = parseArgs({
    args: [...args],
    options: { json: { type: "boolean" } },
    allowPositionals: true,
  });
  const kind = listKindSchema.safeParse(positionals[0] ?? "inbox");
  if (!kind.success) throw new UsageError(t("cli.unknown-list", { list: String(positionals[0]) }));
  return withClient(out, t, async (client) => {
    const answer = await client.get(`/api/ls/${kind.data}`);
    const rows = (Array.isArray(answer.body) ? answer.body : []) as Row[];
    const listed = { ...answer, body: { [kind.data]: rows } as Answer["body"] };
    return printAnswer(out, t, values.json, listed, () => {
      if (rows.length === 0) return [t("cli.nothing-in", { list: kind.data })];
      switch (kind.data) {
        case "inbox":
          return table(
            rows.map((row) => [
              cell(row.ref),
              row.waiting === "merge" ? t("cli.awaiting-merge") : cell(row.waiting),
              row.reason ? `${row.title} (${row.reason})` : cell(row.title),
            ]),
          );
        case "items":
          return table(
            rows.map((row) => [
              cell(row.ref),
              cell(row.shown_stage),
              cell(row.hold),
              cell(row.title),
            ]),
          );
        case "tasks":
          return table(
            rows.map((row) => [cell(row.ref), cell(row.stage), cell(row.hold), cell(row.goal)]),
          );
        case "runs":
          return table(
            rows.map((row) => [
              cell(row.ref),
              cell(row.agent),
              cell(row.state),
              cell(row.task ?? row.item),
              cell(row.started_at),
            ]),
          );
      }
    });
  });
}

// --- kozo show --------------------------------------------------------------------------------

/** The lines `kozo show` prints for the detail of an item, a task or a run. */
export function detailLines(body: Record<string, unknown>, t = english): string[] {
  if (body.kind === "item") {
    const item = body.item as Row & { plan: { approach: string } | null; draft: Plan | null };
    const tasks = (body.tasks ?? []) as Row[];
    return [
      `${item.ref}  ${item.title}`,
      `stage      ${item.shown_stage}`,
      `hold       ${item.hold ? `${item.hold} (${item.hold_reason})` : "-"}`,
      `repository ${item.repository}`,
      ...(item.plan ? [`approach   ${item.plan.approach}`] : []),
      // A plan that waits for approval shows what approving it lets kozod run.
      ...(item.draft
        ? [
            `draft      ${t("cli.draft-summary", { class: item.draft.class, risk: item.draft.risk, approach: item.draft.approach })}`,
            ...(item.draft.shared ?? []).map((agreement) => `  shared  ${agreement}`),
            ...item.draft.tasks.flatMap((task) => [
              `  ${task.id}  ${task.goal}${task.characterize ? ` ${t("cli.characterizes")}` : ""}`,
              ...(task.codemod ? [`      codemod: ${task.codemod}`] : []),
            ]),
          ]
        : []),
      ...tasks.map(
        (task) => `  ${task.ref}  ${task.stage}${task.hold ? ` [${task.hold}]` : ""}  ${task.goal}`,
      ),
    ];
  }
  if (body.kind === "task") {
    const task = body.task as Row & { done_when: string[]; scope: string[] };
    const runs = (body.runs ?? []) as Row[];
    return [
      `${task.ref}  ${task.goal}`,
      `stage      ${task.stage}`,
      `hold       ${task.hold ? `${task.hold} (${task.hold_reason})` : "-"}`,
      `scope      ${task.scope.join(", ")}`,
      ...task.done_when.map((condition) => `done when  ${condition}`),
      ...runs.map((run) => `  ${run.ref}  ${run.agent}  ${run.state}`),
    ];
  }
  const run = body.run as Row;
  return [
    `${run.ref}  ${run.agent} (${run.model})`,
    `state      ${run.state}`,
    `for        ${run.parent ? t("cli.run-under", { target: String(run.task ?? run.item), parent: String(run.parent) }) : (run.task ?? run.item)}`,
    `events     ${body.events}`,
    `cost       $${Number(body.cost_usd).toFixed(2)}`,
  ];
}

function eventSummary(type: string, data: Record<string, unknown>): string {
  switch (type) {
    case "stage.changed":
      return `${data.target} ${data.from} → ${data.to}: ${data.reason}`;
    case "hold.set":
    case "hold.cleared":
      return `${data.target} ${data.hold}${data.reason ? `: ${data.reason}` : ""}`;
    case "agent.message":
      return String(data.text).split("\n")[0] ?? "";
    case "tool.call":
      return String(data.tool);
    case "run.changed":
      return `${data.from} → ${data.to}`;
    default:
      return "";
  }
}

/** One line for an event in `kozo show -f`. */
function eventLine(event: { ts: string; type: string; data: Record<string, unknown> }): string {
  const summary = eventSummary(event.type, event.data);
  return `${event.ts.slice(11, 19)}  ${event.type}${summary ? `  ${summary}` : ""}`;
}

export async function show(args: readonly string[], out: Lines, t = english): Promise<number> {
  const { values, positionals } = parseArgs({
    args: [...args],
    options: {
      follow: { type: "boolean", short: "f" },
      diff: { type: "boolean" },
      json: { type: "boolean" },
    },
    allowPositionals: true,
  });
  const ref = positionals[0];
  if (!ref || !parseReference(ref)) throw new UsageError(t("cli.show-needs-ref"));
  return withClient(out, t, async (client) => {
    const answer = await client.get(refPath(ref));
    if (values.diff && answer.status === 200) {
      const location = answer.body.diff as
        | { repository: string; branch: string; base: string }
        | undefined;
      if (!location) throw new UsageError(t("cli.diff-needs-task"));
      let text: string;
      try {
        text = await git(location.repository, ["diff", `${location.base}...${location.branch}`]);
      } catch (error) {
        if (!(error instanceof GitError)) throw error;
        out.stderr(`kozo: ${printable(error.message)}`);
        return ExitCode.failure;
      }
      for (const line of text.trimEnd().split("\n")) out.stdout(printable(line));
      return ExitCode.success;
    }
    const code = printAnswer(out, t, values.json, answer, () => detailLines(answer.body, t));
    if (!values.follow || code !== ExitCode.success) return code;
    const response = await client.stream(`${refPath(ref)}/events`);
    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const chunk = await reader?.read();
      if (!chunk || chunk.done) return ExitCode.success;
      buffer += decoder.decode(chunk.value, { stream: true });
      let end = buffer.indexOf("\n\n");
      while (end >= 0) {
        const block = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const data = block
          .split("\n")
          .filter((line) => line.startsWith("data: "))
          .map((line) => line.slice(6))
          .join("\n");
        if (data) out.stdout(values.json ? data : printable(eventLine(JSON.parse(data))));
        end = buffer.indexOf("\n\n");
      }
    }
  });
}

// --- verbs ------------------------------------------------------------------------------------

/** `kozo <verb> <ref> [text]`, and `kozo pause` or `kozo resume` with no reference. */
export async function verb(
  name: Verb,
  args: readonly string[],
  out: Lines,
  t = english,
): Promise<number> {
  const { values, positionals } = parseArgs({
    args: [...args],
    options: {
      json: { type: "boolean" },
      now: { type: "boolean" },
      ask: { type: "boolean" },
      before: { type: "string" },
      done: { type: "boolean" },
      cancel: { type: "string" },
    },
    allowPositionals: true,
  });
  const [ref, ...words] = positionals;
  const text = words.join(" ").trim() || undefined;
  if (ref === undefined && (name === "pause" || name === "resume")) {
    return postAndPrint(out, t, values.json, `/api/factory/${name}`);
  }
  const reference = ref === undefined ? null : parseReference(ref);
  if (!ref || !reference) throw new UsageError(t("cli.needs-reference", { verb: name }));
  if (!verbsByKind[reference.kind].includes(name)) {
    throw new UsageError(t("api.verb-kind", { kind: reference.kind, verb: name }));
  }
  const bodies: Record<Verb, () => unknown> = {
    say: () => ({
      text: text ?? missing(t("cli.say-needs-text")),
      ...(values.ask ? { ask: true } : {}),
    }),
    approve: () => ({ text }),
    reject: () => ({ reason: text ?? missing(t("cli.reject-needs-reason")) }),
    pause: () => (values.now ? { now: true } : {}),
    resume: () => ({}),
    retry: () => ({ text }),
    close: () => {
      if (values.done && values.cancel === undefined) return { done: true };
      if (values.cancel && !values.done) return { cancel: values.cancel };
      return missing(t("cli.close-needs-choice"));
    },
    take: () => ({}),
    return: () => ({ text: text ?? missing(t("cli.return-needs-text")) }),
    reorder: () => ({ before: values.before ?? null }),
    issue: () => ({}),
  };
  const body = bodies[name]();
  return postAndPrint(out, t, values.json, `${refPath(ref)}/${name}`, body);
}

function missing(message: string): never {
  throw new UsageError(message);
}

const percent = (value: number | null) => (value === null ? "-" : `${Math.round(value * 100)}%`);
const dollars = (value: number | null) => (value === null ? "-" : `$${value.toFixed(2)}`);

interface Metrics {
  days: number;
  merged: number;
  autonomy_rate: number | null;
  defect_rate: number | null;
  cost_per_diff_usd: number | null;
  hours_to_merge: number | null;
  reviews: number;
  revise_rate: number | null;
  held: number;
  promotions: { repository: string; class: string }[];
  levels?: { repository: string; class: string; level: string }[];
  demotions?: { repository: string; class: string; from: string; to: string; reason: string }[];
  cost_usd?: number;
  failures?: { kind: string; ref: string; at: string; text: string }[];
  noticed?: { task: string; path: string | null; note: string }[];
  calibration?: {
    repository: string;
    class: string;
    tasks: number;
    lines: number;
    files: number;
    scope_blocks: number;
  }[];
}

interface CostReport {
  budget_usd: number;
  today_usd: number;
  days: { day: string; usd: number }[];
}

/** The lines of a metrics report, the targets beside each. */
function metricLines(r: Metrics, t: Words): string[] {
  return [
    t("cli.report-window", { days: r.days, merged: r.merged }),
    `autonomy rate     ${t("cli.metric-autonomy", { rate: percent(r.autonomy_rate) })}`,
    `defect rate       ${t("cli.metric-defect", { rate: percent(r.defect_rate) })}`,
    `cost per diff     ${t("cli.metric-cost", { cost: dollars(r.cost_per_diff_usd) })}`,
    `time to merge     ${t("cli.metric-time", { time: r.hours_to_merge === null ? "-" : `${r.hours_to_merge.toFixed(1)} h` })}`,
    `revise rate       ${t("cli.metric-revise", { rate: percent(r.revise_rate), reviews: r.reviews })}`,
    `held              ${t("cli.metric-held", { held: r.held })}`,
    ...(r.failures === undefined
      ? []
      : [
          "",
          r.failures.length === 0
            ? t("cli.no-failures")
            : t("cli.failures", { count: r.failures.length }),
          ...r.failures.map(
            (f) =>
              `  ${f.at.slice(0, 16).replace("T", " ")}  ${f.kind}  ${f.ref}  ${f.text.split("\n")[0]}`,
          ),
        ]),
    ...(r.promotions.length === 0
      ? []
      : [
          "",
          t("cli.promotions"),
          ...r.promotions.map(
            (p) =>
              `  ${t("cli.class-in-repository", { class: p.class, repository: p.repository })}`,
          ),
        ]),
    ...(r.levels
      ? [
          "",
          t("cli.levels"),
          ...r.levels.map(
            (l) =>
              `  ${l.level}  ${t("cli.class-in-repository", { class: l.class, repository: l.repository })}`,
          ),
        ]
      : []),
    ...(r.demotions && r.demotions.length > 0
      ? [
          "",
          t("cli.demotions"),
          ...r.demotions.map(
            (d) =>
              `  ${t("cli.demotion", { place: t("cli.class-in-repository", { class: d.class, repository: d.repository }), from: d.from, to: d.to, reason: d.reason })}`,
          ),
        ]
      : []),
    ...(r.cost_usd === undefined
      ? []
      : ["", `cost              ${t("cli.cost-in-window", { cost: dollars(r.cost_usd) })}`]),
    ...(r.calibration && r.calibration.length > 0
      ? [
          "",
          t("cli.calibration"),
          ...r.calibration.map(
            (c) =>
              `  ${t("cli.class-in-repository", { class: c.class, repository: c.repository })}  ${t("cli.calibrated", { tasks: c.tasks, lines: c.lines.toFixed(1), files: c.files.toFixed(1), blocks: percent(c.scope_blocks) })}`,
          ),
        ]
      : []),
    ...(r.noticed && r.noticed.length > 0
      ? [
          "",
          t("cli.noticed", { count: r.noticed.length }),
          ...r.noticed.map(
            (n) => `  ${n.task}  ${n.path ? `${n.path}: ` : ""}${n.note.split("\n")[0]}`,
          ),
        ]
      : []),
  ];
}

/** `kozo report`: the metrics over a window of days, or with a flag the review or the cost. */
export async function metricsReport(
  args: readonly string[],
  out: Lines,
  t = english,
): Promise<number> {
  const { values } = parseArgs({
    args: [...args],
    options: {
      days: { type: "string" },
      review: { type: "boolean" },
      cost: { type: "boolean" },
      json: { type: "boolean" },
    },
  });
  if (values.review && values.cost) throw new UsageError(t("cli.report-exclusive"));
  const view = values.review ? "review" : values.cost ? "cost" : "summary";
  const days = values.days ?? "30";
  if (!/^\d+$/.test(days) || Number(days) < 1 || Number(days) > 365)
    throw new UsageError(t("cli.report-days"));
  return await withClient(out, t, async (client) => {
    const answer = await client.get(`/api/report?view=${view}&days=${days}`);
    return printAnswer(out, t, values.json, answer, () => {
      if (view !== "cost") return metricLines(answer.body as unknown as Metrics, t);
      const c = answer.body as unknown as CostReport;
      return [
        `today             ${t("cli.cost-of-budget", { today: dollars(c.today_usd), budget: dollars(c.budget_usd) })}`,
        ...c.days.map((d) => `  ${d.day}  ${dollars(d.usd)}`),
      ];
    });
  });
}

interface EvalSummary {
  cases: {
    id: string;
    expected: string | null;
    outcome: string;
    passed: boolean;
    checks: { command: string; code: number }[];
    costUsd: number;
    forbidden: string[];
    reason?: string;
    error?: string;
  }[];
  passed: number;
  total: number;
  costUsd: number;
}

/**
 * `kozo admin eval add <run>` writes the eval case kozod drafts from a run's item into the
 * factory definition, the human's own files; `kozo admin eval run [<case>...]` runs the cases
 * with `kozod --eval`, which needs no running kozod.
 */
async function evalCommand(args: string[], json: boolean | undefined, out: Lines, t: Words) {
  const [action, ...rest] = args;
  if (action === "add") {
    const [run] = rest;
    if (!run || rest.length > 1) throw new UsageError(t("cli.eval-add-takes-run"));
    return await withClient(out, t, async (client) => {
      const answer = await client.post("/api/admin/eval-case", { run });
      if (answer.status >= 300) return printAnswer(out, t, json, answer, () => []);
      const { id, text } = answer.body as { id: string; text: string };
      const path = join(client.home.factory, "evals", `${id}.yml`);
      if (await Bun.file(path).exists()) {
        out.stderr(`kozo: ${t("cli.eval-exists", { path })}`);
        return ExitCode.failure;
      }
      await Bun.write(path, text);
      return printAnswer(out, t, json, { ...answer, body: { ...answer.body, path } }, () => [
        t("cli.eval-wrote", { path }),
      ]);
    });
  }
  if (action !== "run") throw new UsageError(t("cli.eval-takes"));
  const child = Bun.spawn([...kozodCommand(), "--eval", ...rest], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "inherit",
  });
  const [text, code] = await Promise.all([new Response(child.stdout).text(), child.exited]);
  if (json) {
    out.stdout(text.trim());
    return code;
  }
  let summary: EvalSummary;
  try {
    summary = JSON.parse(text) as EvalSummary;
  } catch {
    out.stderr(`kozo: ${t("cli.eval-no-results")}`);
    return ExitCode.failure;
  }
  for (const result of summary.cases) {
    const failed = result.checks.find((check) => check.code !== 0);
    out.stdout(
      printable(
        `${result.passed ? "pass" : "FAIL"}  ${result.id}  ${result.outcome}${result.passed ? "" : `, ${t("cli.eval-expected", { expected: String(result.expected) })}`}${failed ? `; ${t("cli.exited-with", { command: failed.command, code: failed.code })}` : ""}${result.reason ? `: ${result.reason}` : ""}${result.error ? `; ${result.error}` : ""}  ${dollars(result.costUsd)}`,
      ),
    );
    for (const rule of result.forbidden)
      out.stdout(printable(`      ${t("cli.eval-check-by-hand", { rule })}`));
  }
  out.stdout(
    t("cli.eval-summary", {
      passed: summary.passed,
      total: summary.total,
      cost: dollars(summary.costUsd),
    }),
  );
  return code;
}

/** `kozo admin`: creates the definition, installs a repository, rebuilds kozo.db or prunes runs. */
export async function admin(args: readonly string[], out: Lines, t = english): Promise<number> {
  const { values, positionals } = parseArgs({
    args: [...args],
    options: {
      json: { type: "boolean" },
      "older-than": { type: "string" },
      "dry-run": { type: "boolean" },
    },
    allowPositionals: true,
  });
  if (positionals[0] === "init") return await initFactory(values.json, out, t);
  if (positionals[0] === "install") {
    const path = positionals[1];
    if (!path) throw new UsageError(t("cli.install-takes-path"));
    return await installRepository(resolve(path), values.json, out, t);
  }
  if (positionals[0] === "eval")
    return await evalCommand(positionals.slice(1), values.json, out, t);
  if (positionals[0] === "prune") {
    const days = Number(values["older-than"]);
    if (!Number.isInteger(days) || days < 1) throw new UsageError(t("cli.prune-takes-days"));
    return postAndPrint(out, t, values.json, "/api/admin/prune", {
      older_than_days: days,
      ...(values["dry-run"] ? { dry_run: true } : {}),
    });
  }
  if (positionals[0] !== "db-rebuild") throw new UsageError(t("cli.admin-takes"));
  return postAndPrint(out, t, values.json, "/api/admin/db-rebuild");
}

/**
 * `kozo admin install <path>`: adds kozo's repository template to a repository. In local mode the
 * CLI writes the files for the human to commit; in GitHub mode they reach the repository only as
 * a pull request, which only kozod opens.
 */
async function installRepository(path: string, json: boolean | undefined, out: Lines, t: Words) {
  const home = kozoHome();
  const tip = await definitionTip(home.factory).catch(() => null);
  const definition = await readDefinition(home.factory, tip);
  if (definition.ok && definition.definition.factory.mode === "github")
    return postAndPrint(out, t, json, "/api/admin/install", { repository: path });
  const written = await installRepositoryTemplate(path, { mode: "local" });
  const text =
    written.length === 0
      ? t("cli.install-nothing", { path })
      : t("cli.installed", { files: written.join(", "), path });
  out.stdout(json ? JSON.stringify({ message: text, written }) : text);
  return ExitCode.success;
}

/**
 * `kozo admin init`: creates the factory definition as a git repository from kozo's template.
 * The definition is the human's own configuration, not kozod's state, so the CLI writes it.
 */
async function initFactory(json: boolean | undefined, out: Lines, t: Words): Promise<number> {
  const directory = kozoHome().factory;
  const present = await readdir(directory).catch(() => []);
  if (present.length > 0) {
    out.stderr(`kozo: ${t("cli.init-not-empty", { directory })}`);
    return ExitCode.failure;
  }
  for (const [path, text] of Object.entries(factoryTemplate)) {
    await mkdir(dirname(join(directory, path)), { recursive: true });
    await Bun.write(join(directory, path), text);
  }
  try {
    await git(directory, ["init", "--quiet", "--initial-branch=main"]);
    await git(directory, ["add", "--all"]);
    await git(directory, ["commit", "--quiet", "--message", "Start the factory definition"]);
  } catch (error) {
    if (!(error instanceof GitError)) throw error;
    out.stderr(`kozo: ${t("cli.init-commit-failed", { directory, error: error.message })}`);
    return ExitCode.failure;
  }
  const text = t("cli.init-created", { directory });
  out.stdout(json ? JSON.stringify({ message: text, path: directory }) : text);
  return ExitCode.success;
}
