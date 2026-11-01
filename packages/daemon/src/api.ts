import {
  type AddItem,
  type AutonomyLevel,
  addItemSchema,
  type EvalCaseRequest,
  type Event,
  evalCaseRequestSchema,
  helloProof,
  type Install,
  installSchema,
  isClosed,
  issueText,
  type Locale,
  listKindSchema,
  type Message,
  message,
  messageSchema,
  type Prune,
  parseReference,
  pruneSchema,
  type Reference,
  render,
  type Stage,
  secretMatches,
  type Verb,
  verbBodySchemas,
  verbSchema,
  verbsByKind,
  type WorkClass,
} from "@kozo/core";
import { git } from "@kozo/verify";
import type { BunFile, HTMLBundle } from "bun";
import { type Context, Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { DashboardSessions } from "./dashboard-session.ts";
import type { EventStore } from "./event-store.ts";
import {
  activeRuns,
  costToday,
  detail,
  eventColumn,
  eventsAfter,
  inboxCount,
  list,
} from "./queries.ts";
import { type ReportView, reportDays } from "./report.ts";

const reportViews: readonly ReportView[] = ["summary", "review", "cost"];

/** A refusal from a command, with the HTTP status that the API answers with. */
export class CommandError extends Error {
  constructor(
    readonly status: 400 | 404 | 409 | 422 | 501,
    /** Why the command was refused, as people read it; `message` is its English sentence. */
    readonly reason: Message,
  ) {
    super(render(reason, "en"));
  }
}

export interface VerbResult {
  message: Message;
  /** True when the reference now waits for a human, which the CLI reports as exit code 3. */
  awaitingHuman?: boolean;
}

/** What kozod does for each write; the API only checks and routes requests to these. */
export interface Commands {
  addItem(body: AddItem): Promise<{ ref: string } & VerbResult>;
  act(ref: string, reference: Reference, verb: Verb, body: unknown): Promise<VerbResult>;
  pauseFactory(): Promise<VerbResult>;
  resumeFactory(): Promise<VerbResult>;
  rebuildIndex(): Promise<VerbResult>;
  install(body: Install): Promise<VerbResult>;
  prune(body: Prune): Promise<VerbResult & { before: string; runs: string[] }>;
  evalCase(body: EvalCaseRequest): Promise<VerbResult & { id: string; text: string }>;
}

export interface ApiOptions {
  store: EventStore;
  token: string;
  port: number;
  mode: "local" | "github";
  commands: Commands;
  /** The current time, replaced in tests. */
  now?: () => Date;
  /** The locale the API renders kozo's messages in. */
  locale?: () => Locale;
  /** Where a task's diff lives, for `kozo show --diff`. */
  locateTask?(ref: string): Promise<{ repository: string; branch: string; base: string } | null>;
  /** An item's request body, as the human or the Issue wrote it. */
  request?(item: string): Promise<string>;
  /** The head and handoff report of a task's last final verification that passed, or null. */
  handoff?(task: string): Promise<{ head: string; report: string } | null>;
  /** The dashboard's sessions, whose tokens the API accepts beside its own. */
  sessions?: DashboardSessions;
  /** The registered repositories, which the dashboard offers when it adds an item. */
  repositories?: () => string[];
  /** What the work running now holds back from the daily budget. */
  reservedUsd?: () => number;
  /** A task's records for the detail view, and one evidence file of a run. */
  records?: {
    task(ref: string): Promise<unknown | null>;
    evidence(
      run: string,
      path: string,
    ): Promise<{ file: BunFile; type: string; inline: boolean } | null>;
  };
  /** The work class and autonomy level an open item runs at, or nulls when they are unknown. */
  autonomy?(ref: string): Promise<{ class: WorkClass | null; level: AutonomyLevel | null }>;
  /** What `kozo report` shows for one view. */
  report?(view: ReportView, days: number): Promise<unknown>;
}

// The rendering middleware turns `error` into its sentence beside its code and values.
const error = (c: Context, status: number, reason: Message, issues?: string[]) =>
  c.json({ error: reason, ...(issues ? { issues } : {}) }, status as 400);

function tokenMatches(header: string | undefined, token: string): boolean {
  if (token === "" || !header?.startsWith("Bearer ")) return false;
  return secretMatches(header.slice("Bearer ".length), token);
}

async function jsonBody(c: Context): Promise<unknown> {
  const text = await c.req.text();
  if (text.trim() === "") return {};
  return JSON.parse(text);
}

/**
 * A response body as clients read it: its own `message` or `error` becomes the sentence in
 * `locale` with its code and values beside it, and every other message in it becomes its sentence.
 */
function answered(body: unknown, locale: Locale): unknown {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return shown(body, locale);
  const fields = { ...(body as Record<string, unknown>) };
  for (const key of ["message", "error"]) {
    const recorded = messageSchema.safeParse(fields[key]);
    if (!recorded.success) continue;
    const { code, values } = recorded.data;
    return {
      ...(shown({ ...fields, [key]: undefined }, locale) as object),
      [key]: render(recorded.data, locale),
      code,
      values: shown(values, locale),
    };
  }
  return shown(fields, locale);
}

/** `value` with each of kozo's messages in it rendered in `locale`. */
function shown(value: unknown, locale: Locale): unknown {
  if (Array.isArray(value)) return value.map((entry) => shown(entry, locale));
  if (value === null || typeof value !== "object") return value;
  const recorded = messageSchema.safeParse(value);
  if (recorded.success) return render(recorded.data, locale);
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, shown(entry, locale)]),
  );
}

/**
 * The local API. Every request needs the API token and a Host of this machine; a write that
 * carries an Origin must come from the dashboard's own origin. No CORS header is ever sent.
 */
export function createApi({
  store,
  token,
  port,
  mode,
  commands,
  now = () => new Date(),
  locale = () => "en",
  locateTask,
  request,
  handoff,
  sessions = new DashboardSessions(),
  repositories = () => [],
  reservedUsd = () => 0,
  autonomy,
  records,
  report,
}: ApiOptions) {
  const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  const origins = new Set([...hosts].map((host) => `http://${host}`));
  const app = new Hono();

  app.use("*", async (c, next) => {
    await next();
    if (!c.res.headers.get("content-type")?.startsWith("application/json")) return;
    const body = answered(await c.res.json(), locale());
    c.res = new Response(JSON.stringify(body), { status: c.res.status, headers: c.res.headers });
  });

  app.use("*", async (c, next) => {
    if (!hosts.has(c.req.header("host") ?? "")) return error(c, 421, message("api.unknown-host"));
    if (c.req.method === "GET" && c.req.path === "/api/hello") {
      const nonce = c.req.query("nonce") ?? "";
      if (!/^[0-9a-f]{32,128}$/.test(nonce)) return error(c, 400, message("api.hello-nonce"));
      return c.json({ proof: helloProof(token, nonce) });
    }
    const origin = c.req.header("origin");
    // The page trades the code it was opened with for a session; only its own origin may.
    if (c.req.method === "POST" && c.req.path === "/api/dashboard/session") {
      if (origin === undefined || !origins.has(origin))
        return error(c, 403, message("api.session-origin"));
      const body = (await jsonBody(c).catch(() => ({}))) as { code?: unknown };
      const session = typeof body.code === "string" ? sessions.redeem(body.code) : null;
      if (session === null) return error(c, 403, message("api.code-invalid"));
      return c.json({ token: session });
    }
    const header = c.req.header("authorization");
    const api = tokenMatches(header, token);
    const session = !api && header?.startsWith("Bearer ") && sessions.accepts(header.slice(7));
    if (!api && !session) return error(c, 401, message("api.token"));
    // A code opens a new session, so only the API token, never a session, may ask for one.
    if (c.req.path === "/api/dashboard/code" && !api)
      return error(c, 403, message("api.code-token"));
    if (c.req.method !== "GET" && origin !== undefined && !origins.has(origin)) {
      return error(c, 403, message("api.write-origin"));
    }
    await next();
  });

  app.onError((thrown, c) => {
    if (thrown instanceof CommandError) return error(c, thrown.status, thrown.reason);
    if (thrown instanceof SyntaxError) return error(c, 400, message("api.not-json"));
    return error(c, 500, message("text", { text: thrown.message }));
  });

  app.get("/api/status", (c) => {
    return c.json({
      // `kozo down` signals the pid in kozod.pid only once kozod names it as its own.
      pid: process.pid,
      mode,
      paused: store.state.paused,
      pausedReason: store.state.pausedReason,
      locale: locale(),
      activeRuns: activeRuns(store.db),
      waiting: inboxCount(store.db),
      costTodayUsd: costToday(store.db, now()),
      reservedUsd: reservedUsd(),
      repositories: repositories(),
    });
  });

  app.get("/api/report", async (c) => {
    const view = c.req.query("view") ?? "summary";
    if (!reportViews.includes(view as ReportView) || !report)
      return error(c, 400, message("api.no-view", { view }));
    const days = Number(c.req.query("days") ?? reportDays.default);
    if (!Number.isInteger(days) || days < 1 || days > reportDays.max)
      return error(c, 400, message("api.days", { max: reportDays.max }));
    return c.json(await report(view as ReportView, days));
  });

  app.get("/api/ls/:kind", async (c) => {
    const kind = listKindSchema.safeParse(c.req.param("kind"));
    if (!kind.success)
      return error(c, 400, message("api.unknown-list", { list: c.req.param("kind") ?? "" }));
    const rows = list(store.db, kind.data);
    if (kind.data !== "items") return c.json(rows);
    // Items come in the order kozod starts their work, each open one with the class and level
    // it runs at.
    const position = new Map(store.state.order.map((ref, index) => [ref, index]));
    const items = (rows as { ref: string; stage: Stage }[]).sort(
      (a, b) => (position.get(a.ref) ?? 0) - (position.get(b.ref) ?? 0),
    );
    const unknown = { class: null, level: null };
    return c.json(
      await Promise.all(
        items.map(async (row) => ({
          ...row,
          ...(isClosed(row.stage) || !autonomy
            ? unknown
            : await autonomy(row.ref).catch(() => unknown)),
        })),
      ),
    );
  });

  const reference = (c: Context): [string, Reference] | Response => {
    const ref = c.req.param("ref") ?? "";
    const parsedReference = parseReference(ref);
    if (!parsedReference) return error(c, 400, message("api.not-reference", { ref }));
    return [ref, parsedReference];
  };

  app.get("/api/refs/:ref", async (c) => {
    const found = reference(c);
    if (found instanceof Response) return found;
    const [ref, parsedReference] = found;
    const result = detail(store.db, ref, parsedReference);
    if (!result) return error(c, 404, message("api.missing", { ref }));
    // A file that cannot be read leaves its field out rather than failing the detail.
    if (result.kind === "item") {
      const body = await request?.(ref).catch(() => null);
      return c.json(typeof body === "string" ? { ...result, request: body } : result);
    }
    if (result.kind !== "task") return c.json(result);
    const [location, last] = await Promise.all([
      locateTask?.(ref).catch(() => null) ?? null,
      handoff?.(ref).catch(() => null) ?? null,
    ]);
    return c.json({
      ...result,
      ...(location ? { diff: location } : {}),
      ...(last ? { handoff: last } : {}),
    });
  });

  // A diff past this many characters is cut, since the page renders all of it.
  const diffLimit = 1_000_000;

  app.get("/api/refs/:ref/diff", async (c) => {
    const found = reference(c);
    if (found instanceof Response) return found;
    const [ref, parsedReference] = found;
    if (parsedReference.kind !== "task") return error(c, 400, message("api.diff-task"));
    const location = await locateTask?.(ref).catch(() => null);
    if (!location) return error(c, 404, message("api.no-diff", { ref }));
    const text = await git(location.repository, [
      "diff",
      `${location.base}...${location.branch}`,
    ]).catch(() => null);
    if (text === null) return error(c, 404, message("api.no-branch", { ref }));
    const cut = text.length > diffLimit;
    return c.json({
      base: location.base,
      branch: location.branch,
      diff: cut ? text.slice(0, diffLimit) : text,
      cut,
    });
  });

  app.get("/api/refs/:ref/records", async (c) => {
    const found = reference(c);
    if (found instanceof Response) return found;
    const [ref, parsedReference] = found;
    if (parsedReference.kind !== "task") return error(c, 400, message("api.records-task"));
    const result = await records?.task(ref);
    if (!result) return error(c, 404, message("api.missing", { ref }));
    return c.json(result);
  });

  // The files are an agent's, so none is ever run or rendered by the browser as a page.
  app.get("/api/runs/:run/evidence/*", async (c) => {
    const run = c.req.param("run");
    if (parseReference(run)?.kind !== "run") return error(c, 400, message("api.not-run", { run }));
    const path = decodeURIComponent(c.req.path.slice(`/api/runs/${run}/evidence/`.length));
    const found = await records?.evidence(run, path);
    if (!found) return error(c, 404, message("api.no-evidence"));
    return new Response(found.file, {
      headers: {
        "content-type": found.type,
        "x-content-type-options": "nosniff",
        "content-security-policy": "sandbox; default-src 'none'",
        ...(found.inline ? {} : { "content-disposition": "attachment" }),
      },
    });
  });

  const exists = (ref: string) => {
    const state = store.state;
    return ref in state.items || ref in state.tasks || ref in state.runs;
  };

  app.get("/api/refs/:ref/events", (c) => {
    const found = reference(c);
    if (found instanceof Response) return found;
    const [ref, parsedReference] = found;
    if (!exists(ref)) return error(c, 404, message("api.missing", { ref }));
    const after = Number(c.req.header("last-event-id") ?? c.req.query("after") ?? 0) || 0;
    const column = eventColumn[parsedReference.kind];
    const matches = (event: Event) => (column === "run_id" ? event.run_id : event[column]) === ref;
    return streamSSE(c, async (stream) => {
      let last = after;
      const pending: { event: Event; id: number }[] = [];
      let wake: (() => void) | null = null;
      const unsubscribe = store.subscribe((event, id) => {
        if (!matches(event)) return;
        pending.push({ event, id });
        wake?.();
      });
      const keepalive = setInterval(() => void stream.write(": keepalive\n\n"), 15_000);
      stream.onAbort(() => {
        unsubscribe();
        clearInterval(keepalive);
        wake?.();
      });
      for (const row of eventsAfter(store.db, parsedReference, ref, after)) {
        await stream.writeSSE({
          id: String(row.id),
          event: "event",
          data: JSON.stringify(shown(JSON.parse(row.line), locale())),
        });
        last = row.id;
      }
      while (!stream.aborted) {
        const next = pending.shift();
        if (!next) {
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
          wake = null;
          continue;
        }
        if (next.id <= last) continue;
        await stream.writeSSE({
          id: String(next.id),
          event: "event",
          data: JSON.stringify(shown(next.event, locale())),
        });
        last = next.id;
      }
    });
  });

  app.post("/api/items", async (c) => {
    const body = addItemSchema.safeParse(await jsonBody(c));
    if (!body.success)
      return error(
        c,
        400,
        message("api.invalid-item"),
        body.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      );
    return c.json(await commands.addItem(body.data), 201);
  });

  app.post("/api/refs/:ref/:verb", async (c) => {
    const found = reference(c);
    if (found instanceof Response) return found;
    const [ref, parsedReference] = found;
    const verb = verbSchema.safeParse(c.req.param("verb"));
    if (!verb.success)
      return error(c, 400, message("api.unknown-verb", { verb: c.req.param("verb") ?? "" }));
    if (!verbsByKind[parsedReference.kind].includes(verb.data)) {
      return error(
        c,
        400,
        message("api.verb-kind", { kind: parsedReference.kind, verb: verb.data }),
      );
    }
    const body = verbBodySchemas[verb.data].safeParse(await jsonBody(c));
    if (!body.success) {
      return error(
        c,
        400,
        message("api.invalid-verb", { verb: verb.data }),
        body.error.issues.map((i) => `${i.path.join(".") || "<body>"}: ${i.message}`),
      );
    }
    if (!exists(ref)) return error(c, 404, message("api.missing", { ref }));
    return c.json(await commands.act(ref, parsedReference, verb.data, body.data));
  });

  app.post("/api/dashboard/code", (c) => c.json({ code: sessions.code() }));
  app.post("/api/factory/pause", async (c) => c.json(await commands.pauseFactory()));
  app.post("/api/factory/resume", async (c) => c.json(await commands.resumeFactory()));
  app.post("/api/admin/db-rebuild", async (c) => c.json(await commands.rebuildIndex()));
  app.post("/api/admin/install", async (c) => {
    const body = installSchema.safeParse(await jsonBody(c));
    if (!body.success)
      return error(c, 400, message("api.invalid-install"), body.error.issues.map(issueText));
    return c.json(await commands.install(body.data));
  });
  app.post("/api/admin/eval-case", async (c) => {
    const body = evalCaseRequestSchema.safeParse(await jsonBody(c));
    if (!body.success)
      return error(c, 400, message("api.invalid-eval"), body.error.issues.map(issueText));
    return c.json(await commands.evalCase(body.data));
  });
  app.post("/api/admin/prune", async (c) => {
    const body = pruneSchema.safeParse(await jsonBody(c));
    if (!body.success)
      return error(c, 400, message("api.invalid-prune"), body.error.issues.map(issueText));
    return c.json(await commands.prune(body.data));
  });

  app.notFound((c) => error(c, 404, message("api.no-endpoint")));
  return app;
}

/**
 * Serves the API on 127.0.0.1 only, and the dashboard at `/`: a page without data, which reads
 * the API with the token it is handed. SSE streams keep the connection open, so idling is
 * allowed.
 */
export function serveApi(app: Hono, port: number, dashboard?: HTMLBundle) {
  return Bun.serve({
    hostname: "127.0.0.1",
    port,
    idleTimeout: 0,
    development: false,
    ...(dashboard ? { routes: { "/": dashboard } } : {}),
    fetch: app.fetch,
  });
}
