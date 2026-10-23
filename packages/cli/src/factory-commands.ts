import { spawn } from "node:child_process";
import { mkdir, open, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  factoryTemplate,
  type KozoHome,
  kozoHome,
  listKindSchema,
  type Plan,
  parseReference,
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

function printAnswer(out: Lines, json: boolean | undefined, answer: Answer, text: () => string[]) {
  if (json) {
    out.stdout(JSON.stringify(answer.body));
  } else if (answer.status >= 300) {
    out.stderr(
      `kozo: ${printable(String(answer.body.error ?? `kozod answered ${answer.status}`))}`,
    );
    for (const issue of answer.body.issues ?? []) out.stderr(`  ${printable(String(issue))}`);
  } else {
    for (const line of text()) out.stdout(printable(line));
  }
  return exitFor(answer);
}

/** Posts to the local API and prints kozod's message, or the whole answer with --json. */
function postAndPrint(out: Lines, json: boolean | undefined, path: string, body?: unknown) {
  return withClient(out, async (client) => {
    const answer = await client.post(path, body);
    return printAnswer(out, json, answer, () => [String(answer.body.message)]);
  });
}

async function withClient(out: Lines, work: (client: Client) => Promise<number>) {
  try {
    return await work(await connect());
  } catch (error) {
    if (!(error instanceof KozodUnavailable)) throw error;
    out.stderr(`kozo: ${error.message}`);
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
  throw new KozodUnavailable("kozod is not installed beside kozo or on PATH; set KOZOD to it");
}

async function running(home: KozoHome): Promise<boolean> {
  try {
    const client = await connect(home);
    return (await client.get("/api/status")).status === 200;
  } catch {
    return false;
  }
}

export async function up(args: readonly string[], out: Lines): Promise<number> {
  const { values } = parseArgs({ args: [...args], options: { json: { type: "boolean" } } });
  const home = kozoHome();
  const url = `http://127.0.0.1:${apiPortFromEnvironment()}`;
  const report = (message: string) => {
    out.stdout(values.json ? JSON.stringify({ url, message }) : `${message}: ${url}`);
    return ExitCode.success;
  };
  if (await running(home)) return report("kozod is already running");
  await mkdir(home.root, { recursive: true, mode: 0o700 });
  const log = await open(join(home.root, "kozod.log"), "a");
  let command: string[];
  try {
    command = kozodCommand();
  } catch (error) {
    out.stderr(`kozo: ${(error as Error).message}`);
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
      return report("kozod is up");
    }
    await Bun.sleep(100);
  }
  await log.close();
  out.stderr(`kozo: kozod did not start; see ${join(home.root, "kozod.log")}`);
  return ExitCode.failure;
}

export async function down(args: readonly string[], out: Lines): Promise<number> {
  const { values } = parseArgs({ args: [...args], options: { json: { type: "boolean" } } });
  const home = kozoHome();
  const report = (message: string) => {
    out.stdout(values.json ? JSON.stringify({ message }) : message);
    return ExitCode.success;
  };
  const file = Bun.file(home.pidFile);
  if (!(await file.exists())) return report("kozod is not running");
  const pid = Number((await file.text()).trim());
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    return report("kozod is not running");
  }
  for (let waited = 0; waited < 15_000; waited += 100) {
    try {
      process.kill(pid, 0);
    } catch {
      return report("kozod is down");
    }
    await Bun.sleep(100);
  }
  out.stderr(`kozo: kozod (pid ${pid}) did not stop within 15 seconds`);
  return ExitCode.failure;
}

// --- kozo dashboard ---------------------------------------------------------------------------

/**
 * Opens the dashboard in the browser with a code that the page trades for a session; with
 * --url, prints that URL instead. The code is good once, for a minute, and lives in the URL's
 * fragment, which the browser never sends to a server.
 */
export async function dashboard(args: readonly string[], out: Lines): Promise<number> {
  const { values } = parseArgs({
    args: [...args],
    options: { url: { type: "boolean" }, json: { type: "boolean" } },
  });
  return withClient(out, async (client) => {
    const answer = await client.post("/api/dashboard/code");
    if (answer.status !== 200) return printAnswer(out, values.json, answer, () => []);
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
      out.stderr(`kozo: ${opener} could not open the browser; run kozo dashboard --url`);
      return ExitCode.failure;
    }
    const message = `opened the dashboard at ${client.base}/`;
    out.stdout(values.json ? JSON.stringify({ message }) : message);
    return ExitCode.success;
  });
}

// --- kozo status ------------------------------------------------------------------------------

export async function status(args: readonly string[], out: Lines): Promise<number> {
  const { values } = parseArgs({
    args: [...args],
    options: { line: { type: "boolean" }, json: { type: "boolean" } },
  });
  let answer: Answer;
  try {
    answer = await (await connect()).get("/api/status");
  } catch (error) {
    if (!(error instanceof KozodUnavailable)) throw error;
    if (values.line) out.stdout("kozo: down");
    else if (values.json) out.stdout(JSON.stringify({ running: false }));
    else out.stderr(`kozo: ${error.message}`);
    return ExitCode.failure;
  }
  const s = answer.body as {
    mode: string;
    paused: boolean;
    pausedReason: string | null;
    activeRuns: number;
    waiting: number;
    costTodayUsd: number;
  };
  const cost = `$${s.costTodayUsd.toFixed(2)}`;
  if (values.line) {
    const state = s.paused ? "paused" : "up";
    out.stdout(
      `kozo: ${state} ${s.mode} · ${s.activeRuns} running · ${s.waiting} waiting · ${cost} today`,
    );
    return exitFor(answer);
  }
  return printAnswer(
    out,
    values.json,
    { ...answer, body: { running: true, ...answer.body } },
    () => [
      `kozod     ${s.paused ? `paused (${s.pausedReason})` : "running"}`,
      `mode      ${s.mode}`,
      `runs      ${s.activeRuns} running`,
      `waiting   ${s.waiting} in the inbox`,
      `cost      ${cost} today`,
    ],
  );
}

// --- kozo add ---------------------------------------------------------------------------------

export async function add(args: readonly string[], out: Lines): Promise<number> {
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
  if (workClass && !workClass.success) throw new UsageError(`unknown work class '${values.class}'`);
  let text = positionals.join(" ");
  if (values.file) text = `${text}\n${await Bun.file(values.file).text()}`.trim();
  const [title = "", ...rest] = text.trim().split("\n");
  if (title.trim() === "") throw new UsageError("add needs the request text");
  return postAndPrint(out, values.json, "/api/items", {
    title: title.trim(),
    body: rest.join("\n").trim() || undefined,
    repository: values.repo,
    class: workClass?.data,
  });
}

// --- kozo ls ----------------------------------------------------------------------------------

export async function ls(args: readonly string[], out: Lines): Promise<number> {
  const { values, positionals } = parseArgs({
    args: [...args],
    options: { json: { type: "boolean" } },
    allowPositionals: true,
  });
  const kind = listKindSchema.safeParse(positionals[0] ?? "inbox");
  if (!kind.success) throw new UsageError(`unknown list '${positionals[0]}'`);
  return withClient(out, async (client) => {
    const answer = await client.get(`/api/ls/${kind.data}`);
    const rows = (Array.isArray(answer.body) ? answer.body : []) as Row[];
    const listed = { ...answer, body: { [kind.data]: rows } as Answer["body"] };
    return printAnswer(out, values.json, listed, () => {
      if (rows.length === 0) return [`nothing in ${kind.data}`];
      switch (kind.data) {
        case "inbox":
          return table(
            rows.map((row) => [
              cell(row.ref),
              row.waiting === "merge" ? "awaiting merge" : cell(row.waiting),
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
export function detailLines(body: Record<string, unknown>): string[] {
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
            `draft      ${item.draft.class}, ${item.draft.risk} risk: ${item.draft.approach}`,
            ...item.draft.tasks.flatMap((task) => [
              `  ${task.id}  ${task.goal}${task.characterize ? " (characterizes)" : ""}`,
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
    `for        ${run.task ?? run.item}${run.parent ? ` under ${run.parent}` : ""}`,
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

export async function show(args: readonly string[], out: Lines): Promise<number> {
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
  if (!ref || !parseReference(ref))
    throw new UsageError("show needs an item, task or run reference");
  return withClient(out, async (client) => {
    const answer = await client.get(refPath(ref));
    if (values.diff && answer.status === 200) {
      const location = answer.body.diff as
        | { repository: string; branch: string; base: string }
        | undefined;
      if (!location) throw new UsageError("--diff needs a task reference");
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
    const code = printAnswer(out, values.json, answer, () => detailLines(answer.body));
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
export async function verb(name: Verb, args: readonly string[], out: Lines): Promise<number> {
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
    return postAndPrint(out, values.json, `/api/factory/${name}`);
  }
  const reference = ref === undefined ? null : parseReference(ref);
  if (!ref || !reference) throw new UsageError(`${name} needs a reference`);
  if (!verbsByKind[reference.kind].includes(name)) {
    throw new UsageError(`a ${reference.kind} does not take ${name}`);
  }
  const bodies: Record<Verb, () => unknown> = {
    say: () => ({
      text: text ?? missing("say needs the text to send"),
      ...(values.ask ? { ask: true } : {}),
    }),
    approve: () => ({ text }),
    reject: () => ({ reason: text ?? missing("reject needs a reason") }),
    pause: () => (values.now ? { now: true } : {}),
    resume: () => ({}),
    retry: () => ({ text }),
    close: () => {
      if (values.done && values.cancel === undefined) return { done: true };
      if (values.cancel && !values.done) return { cancel: values.cancel };
      return missing("close needs --done or --cancel <reason>");
    },
    take: () => ({}),
    return: () => ({ text: text ?? missing("return needs what you changed and checked") }),
    reorder: () => ({ before: values.before ?? null }),
  };
  const body = bodies[name]();
  return postAndPrint(out, values.json, `${refPath(ref)}/${name}`, body);
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
}

interface CostReport {
  budget_usd: number;
  today_usd: number;
  days: { day: string; usd: number }[];
}

/** The lines of a metrics report, the targets beside each. */
function metricLines(r: Metrics): string[] {
  return [
    `over the last ${r.days} days, ${r.merged} merged diffs`,
    `autonomy rate     ${percent(r.autonomy_rate)}  (70% or more)`,
    `defect rate       ${percent(r.defect_rate)}  (5% or less)`,
    `cost per diff     ${dollars(r.cost_per_diff_usd)}  (median)`,
    `time to merge     ${r.hours_to_merge === null ? "-" : `${r.hours_to_merge.toFixed(1)} h`}  (median, within 24 h)`,
    `revise rate       ${percent(r.revise_rate)} of ${r.reviews} reviews  (10% to 30%)`,
    `held              ${r.held} questions and attention  (10 or fewer)`,
    ...(r.failures === undefined
      ? []
      : [
          "",
          r.failures.length === 0
            ? "no failures in the window"
            : `failures in the window, for the retrospective: ${r.failures.length}`,
          ...r.failures.map(
            (f) =>
              `  ${f.at.slice(0, 16).replace("T", " ")}  ${f.kind}  ${f.ref}  ${f.text.split("\n")[0]}`,
          ),
        ]),
    ...(r.promotions.length === 0
      ? []
      : [
          "",
          "promotion proposals: raise to L3 in the Charter",
          ...r.promotions.map((p) => `  ${p.class} in ${p.repository}`),
        ]),
    ...(r.levels
      ? [
          "",
          "levels as kozod applies them",
          ...r.levels.map((l) => `  ${l.level}  ${l.class} in ${l.repository}`),
        ]
      : []),
    ...(r.demotions && r.demotions.length > 0
      ? [
          "",
          "demotions, until the Charter changes",
          ...r.demotions.map(
            (d) => `  ${d.class} in ${d.repository}: ${d.from} to ${d.to}, ${d.reason}`,
          ),
        ]
      : []),
    ...(r.cost_usd === undefined
      ? []
      : ["", `cost              ${dollars(r.cost_usd)} in the window`]),
  ];
}

/** `kozo report`: the metrics, or with a flag the week's, the monthly review or the cost. */
export async function metricsReport(args: readonly string[], out: Lines): Promise<number> {
  const { values } = parseArgs({
    args: [...args],
    options: {
      week: { type: "boolean" },
      review: { type: "boolean" },
      cost: { type: "boolean" },
      json: { type: "boolean" },
    },
  });
  const views = (["week", "review", "cost"] as const).filter((view) => values[view]);
  if (views.length > 1) throw new UsageError("report takes one of --week, --review and --cost");
  const view = views[0] ?? "summary";
  const answer = await (await connect()).get(`/api/report?view=${view}`);
  return printAnswer(out, values.json, answer, () => {
    if (view !== "cost") return metricLines(answer.body as unknown as Metrics);
    const c = answer.body as unknown as CostReport;
    return [
      `today             ${dollars(c.today_usd)} of ${dollars(c.budget_usd)}`,
      ...c.days.map((d) => `  ${d.day.slice(0, 10)}  ${dollars(d.usd)}`),
    ];
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
async function evalCommand(args: string[], json: boolean | undefined, out: Lines) {
  const [action, ...rest] = args;
  if (action === "add") {
    const [run] = rest;
    if (!run || rest.length > 1) throw new UsageError("admin eval add takes one run, r-<nnnn>");
    const client = await connect();
    const answer = await client.post("/api/admin/eval-case", { run });
    if (answer.status >= 300) return printAnswer(out, json, answer, () => []);
    const { id, text } = answer.body as { id: string; text: string };
    const path = join(client.home.factory, "evals", `${id}.yml`);
    if (await Bun.file(path).exists()) {
      out.stderr(`kozo: ${path} exists already; remove it to draft it again`);
      return ExitCode.failure;
    }
    await Bun.write(path, text);
    return printAnswer(out, json, { ...answer, body: { ...answer.body, path } }, () => [
      `wrote ${path}; add the hidden tests and checks it needs, then commit it`,
    ]);
  }
  if (action !== "run") throw new UsageError("admin eval takes add or run");
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
    out.stderr("kozo: kozod --eval printed no results");
    return ExitCode.failure;
  }
  for (const result of summary.cases) {
    const failed = result.checks.find((check) => check.code !== 0);
    out.stdout(
      printable(
        `${result.passed ? "pass" : "FAIL"}  ${result.id}  ${result.outcome}${result.passed ? "" : `, expected ${result.expected}`}${failed ? `; ${failed.command} exited with ${failed.code}` : ""}${result.error ? `; ${result.error}` : ""}  ${dollars(result.costUsd)}`,
      ),
    );
    for (const rule of result.forbidden) out.stdout(printable(`      check by hand: ${rule}`));
  }
  out.stdout(
    `${summary.passed} of ${summary.total} reached the expected outcome; ${dollars(summary.costUsd)} in all`,
  );
  return code;
}

/** `kozo admin`: creates the definition, installs a repository, rebuilds kozo.db or prunes runs. */
export async function admin(args: readonly string[], out: Lines): Promise<number> {
  const { values, positionals } = parseArgs({
    args: [...args],
    options: {
      json: { type: "boolean" },
      "older-than": { type: "string" },
      "dry-run": { type: "boolean" },
    },
    allowPositionals: true,
  });
  if (positionals[0] === "init") return await initFactory(values.json, out);
  if (positionals[0] === "install") {
    const path = positionals[1];
    if (!path) throw new UsageError("admin install takes the repository's path");
    return await installRepository(resolve(path), values.json, out);
  }
  if (positionals[0] === "eval") return await evalCommand(positionals.slice(1), values.json, out);
  if (positionals[0] === "prune") {
    const days = Number(values["older-than"]);
    if (!Number.isInteger(days) || days < 1)
      throw new UsageError("admin prune takes --older-than <days>, a whole number of days");
    return postAndPrint(out, values.json, "/api/admin/prune", {
      older_than_days: days,
      ...(values["dry-run"] ? { dry_run: true } : {}),
    });
  }
  if (positionals[0] !== "db-rebuild")
    throw new UsageError("admin takes init, install, db-rebuild, prune or eval");
  return postAndPrint(out, values.json, "/api/admin/db-rebuild");
}

/**
 * `kozo admin install <path>`: adds kozo's repository template to a repository. In local mode the
 * CLI writes the files for the human to commit; in GitHub mode they reach the repository only as
 * a pull request, which only kozod opens.
 */
async function installRepository(path: string, json: boolean | undefined, out: Lines) {
  const home = kozoHome();
  const tip = await definitionTip(home.factory).catch(() => null);
  const definition = await readDefinition(home.factory, tip);
  if (definition.ok && definition.definition.factory.mode === "github")
    return postAndPrint(out, json, "/api/admin/install", { repository: path });
  const written = await installRepositoryTemplate(path, "local");
  const message =
    written.length === 0
      ? `${path} has every file kozo installs`
      : `added ${written.join(", ")} to ${path}; edit them, set status: ready in .kozo/charter.yml and commit them`;
  out.stdout(json ? JSON.stringify({ message, written }) : message);
  return ExitCode.success;
}

/**
 * `kozo admin init`: creates the factory definition as a git repository from kozo's template.
 * The definition is the human's own configuration, not kozod's state, so the CLI writes it.
 */
async function initFactory(json: boolean | undefined, out: Lines): Promise<number> {
  const directory = kozoHome().factory;
  const present = await readdir(directory).catch(() => []);
  if (present.length > 0) {
    out.stderr(`kozo: ${directory} is not empty; the factory definition is already there`);
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
    out.stderr(`kozo: wrote ${directory}, but could not commit it: ${error.message}`);
    return ExitCode.failure;
  }
  const message = `created the factory definition in ${directory}; add a repository to factory.yml and commit it`;
  out.stdout(json ? JSON.stringify({ message, path: directory }) : message);
  return ExitCode.success;
}
