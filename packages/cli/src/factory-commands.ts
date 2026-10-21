import { spawn } from "node:child_process";
import { mkdir, open } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import {
  type KozoHome,
  kozoHome,
  listKindSchema,
  parseReference,
  type Verb,
  verbsByKind,
  workClassSchema,
} from "@kozo/core";
import {
  type Answer,
  apiPortFromEnvironment,
  type Client,
  connect,
  KozodUnavailable,
  refPath,
} from "./client.ts";

export const FactoryExit = {
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
export class FactoryUsageError extends Error {}

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
  if (answer.status === 404) return FactoryExit.notFound;
  if (answer.status === 400) return FactoryExit.usage;
  if (answer.status >= 300) return FactoryExit.failure;
  return answer.body.awaitingHuman === true ? FactoryExit.awaitingHuman : FactoryExit.success;
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

async function withClient(out: Lines, work: (client: Client) => Promise<number>) {
  try {
    return await work(await connect());
  } catch (error) {
    if (!(error instanceof KozodUnavailable)) throw error;
    out.stderr(`kozo: ${error.message}`);
    return FactoryExit.failure;
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

const waitingLabels: Record<string, string> = {
  approval: "approval",
  question: "question",
  attention: "attention",
  merge: "awaiting merge",
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
    return FactoryExit.success;
  };
  if (await running(home)) return report("kozod is already running");
  await mkdir(home.root, { recursive: true, mode: 0o700 });
  const log = await open(join(home.root, "kozod.log"), "a");
  let command: string[];
  try {
    command = kozodCommand();
  } catch (error) {
    out.stderr(`kozo: ${(error as Error).message}`);
    return FactoryExit.failure;
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
  return FactoryExit.failure;
}

export async function down(args: readonly string[], out: Lines): Promise<number> {
  const { values } = parseArgs({ args: [...args], options: { json: { type: "boolean" } } });
  const home = kozoHome();
  const report = (message: string) => {
    out.stdout(values.json ? JSON.stringify({ message }) : message);
    return FactoryExit.success;
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
  return FactoryExit.failure;
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
    return FactoryExit.failure;
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
  if (workClass && !workClass.success)
    throw new FactoryUsageError(`unknown work class '${values.class}'`);
  let text = positionals.join(" ");
  if (values.file) text = `${text}\n${await Bun.file(values.file).text()}`.trim();
  const [title = "", ...rest] = text.trim().split("\n");
  if (title.trim() === "") throw new FactoryUsageError("add needs the request text");
  return withClient(out, async (client) => {
    const answer = await client.post("/api/items", {
      title: title.trim(),
      body: rest.join("\n").trim() || undefined,
      repository: values.repo,
      class: workClass?.data,
    });
    return printAnswer(out, values.json, answer, () => [String(answer.body.message)]);
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
  if (!kind.success) throw new FactoryUsageError(`unknown list '${positionals[0]}'`);
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
              waitingLabels[cell(row.waiting)] ?? cell(row.waiting),
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

function describe(body: Record<string, unknown>): string[] {
  if (body.kind === "item") {
    const item = body.item as Row & { plan: { approach: string } | null };
    const tasks = (body.tasks ?? []) as Row[];
    return [
      `${item.ref}  ${item.title}`,
      `stage      ${item.shown_stage}`,
      `hold       ${item.hold ? `${item.hold} (${item.hold_reason})` : "-"}`,
      `repository ${item.repository}`,
      ...(item.plan ? [`approach   ${item.plan.approach}`] : []),
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

/** One line for an event in `kozo show -f`. */
export function eventLine(event: {
  ts: string;
  type: string;
  data: Record<string, unknown>;
}): string {
  const data = event.data;
  const summary =
    event.type === "stage.changed"
      ? `${data.target} ${data.from} → ${data.to}`
      : event.type === "hold.set" || event.type === "hold.cleared"
        ? `${data.target} ${data.hold}${data.reason ? `: ${data.reason}` : ""}`
        : event.type === "agent.message"
          ? String(data.text).split("\n")[0]
          : event.type === "tool.call"
            ? String(data.tool)
            : event.type === "run.changed"
              ? `${data.from} → ${data.to}`
              : "";
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
    throw new FactoryUsageError("show needs an item, task or run reference");
  return withClient(out, async (client) => {
    const answer = await client.get(refPath(ref));
    if (values.diff && answer.status === 200) {
      const location = answer.body.diff as
        | { repository: string; branch: string; base: string }
        | undefined;
      if (!location) throw new FactoryUsageError("--diff needs a task reference");
      const child = Bun.spawn(
        ["git", "-C", location.repository, "diff", `${location.base}...${location.branch}`],
        { stdout: "pipe", stderr: "pipe" },
      );
      const text = await new Response(child.stdout).text();
      if ((await child.exited) !== 0) {
        out.stderr(`kozo: ${printable(await new Response(child.stderr).text())}`);
        return FactoryExit.failure;
      }
      for (const line of text.trimEnd().split("\n")) out.stdout(printable(line));
      return FactoryExit.success;
    }
    const code = printAnswer(out, values.json, answer, () => describe(answer.body));
    if (!values.follow || code !== FactoryExit.success) return code;
    const response = await client.stream(`${refPath(ref)}/events`);
    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const chunk = await reader?.read();
      if (!chunk || chunk.done) return FactoryExit.success;
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
      done: { type: "boolean" },
      cancel: { type: "string" },
    },
    allowPositionals: true,
  });
  const [ref, ...words] = positionals;
  const text = words.join(" ").trim() || undefined;
  if (ref === undefined && (name === "pause" || name === "resume")) {
    return withClient(out, async (client) => {
      const answer = await client.post(`/api/factory/${name}`);
      return printAnswer(out, values.json, answer, () => [String(answer.body.message)]);
    });
  }
  const reference = ref === undefined ? null : parseReference(ref);
  if (!ref || !reference) throw new FactoryUsageError(`${name} needs a reference`);
  if (!verbsByKind[reference.kind].includes(name)) {
    throw new FactoryUsageError(`a ${reference.kind} does not take ${name}`);
  }
  const bodies: Record<Verb, () => unknown> = {
    say: () => ({ text: text ?? missing("say needs the text to send") }),
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
  };
  const body = bodies[name]();
  return withClient(out, async (client) => {
    const answer = await client.post(`${refPath(ref)}/${name}`, body);
    return printAnswer(out, values.json, answer, () => [String(answer.body.message)]);
  });
}

function missing(message: string): never {
  throw new FactoryUsageError(message);
}

/** `kozo admin db-rebuild`: rebuilds kozo.db from the event logs. */
export async function admin(args: readonly string[], out: Lines): Promise<number> {
  const { values, positionals } = parseArgs({
    args: [...args],
    options: { json: { type: "boolean" } },
    allowPositionals: true,
  });
  if (positionals[0] !== "db-rebuild") throw new FactoryUsageError("admin takes db-rebuild");
  return withClient(out, async (client) => {
    const answer = await client.post("/api/admin/db-rebuild");
    return printAnswer(out, values.json, answer, () => [String(answer.body.message)]);
  });
}
