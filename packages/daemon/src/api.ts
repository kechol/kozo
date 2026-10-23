import {
  type AddItem,
  type ApiError,
  addItemSchema,
  type Event,
  helloProof,
  type Install,
  installSchema,
  issueText,
  listKindSchema,
  parseReference,
  type Reference,
  secretMatches,
  type Verb,
  verbBodySchemas,
  verbSchema,
  verbsByKind,
} from "@kozo/core";
import type { HTMLBundle } from "bun";
import { type Context, Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { EventStore } from "./event-store.ts";
import {
  activeRuns,
  costSince,
  detail,
  eventColumn,
  eventsAfter,
  inboxCount,
  list,
} from "./queries.ts";

/** A refusal from a command, with the HTTP status that the API answers with. */
export class CommandError extends Error {
  constructor(
    readonly status: 400 | 404 | 409 | 422 | 501,
    message: string,
  ) {
    super(message);
  }
}

export interface VerbResult {
  message: string;
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
}

export interface ApiOptions {
  store: EventStore;
  token: string;
  port: number;
  mode: "local" | "github";
  commands: Commands;
  /** The current time, replaced in tests. */
  now?: () => Date;
  /** Where a task's diff lives, for `kozo show --diff`. */
  locateTask?(ref: string): Promise<{ repository: string; branch: string; base: string } | null>;
}

const error = (c: Context, status: number, message: string, issues?: string[]) =>
  c.json({ error: message, ...(issues ? { issues } : {}) } satisfies ApiError, status as 400);

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
  locateTask,
}: ApiOptions) {
  const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  const origins = new Set([...hosts].map((host) => `http://${host}`));
  const app = new Hono();

  app.use("*", async (c, next) => {
    if (!hosts.has(c.req.header("host") ?? "")) return error(c, 421, "unknown host");
    if (c.req.method === "GET" && c.req.path === "/api/hello") {
      const nonce = c.req.query("nonce") ?? "";
      if (!/^[0-9a-f]{32,128}$/.test(nonce)) return error(c, 400, "hello needs a hex nonce");
      return c.json({ proof: helloProof(token, nonce) });
    }
    if (!tokenMatches(c.req.header("authorization"), token))
      return error(c, 401, "missing or wrong API token");
    const origin = c.req.header("origin");
    if (c.req.method !== "GET" && origin !== undefined && !origins.has(origin)) {
      return error(c, 403, "writes are accepted only from this machine's own origin");
    }
    await next();
  });

  app.onError((thrown, c) => {
    if (thrown instanceof CommandError) return error(c, thrown.status, thrown.message);
    if (thrown instanceof SyntaxError) return error(c, 400, "the body is not JSON");
    return error(c, 500, thrown.message);
  });

  app.get("/api/status", (c) => {
    const today = now();
    today.setHours(0, 0, 0, 0);
    return c.json({
      mode,
      paused: store.state.paused,
      pausedReason: store.state.pausedReason,
      activeRuns: activeRuns(store.db),
      waiting: inboxCount(store.db),
      costTodayUsd: costSince(store.db, today),
    });
  });

  app.get("/api/ls/:kind", (c) => {
    const kind = listKindSchema.safeParse(c.req.param("kind"));
    if (!kind.success) return error(c, 400, `unknown list ${c.req.param("kind")}`);
    return c.json(list(store.db, kind.data));
  });

  const reference = (c: Context): [string, Reference] | Response => {
    const ref = c.req.param("ref") ?? "";
    const parsedReference = parseReference(ref);
    if (!parsedReference) return error(c, 400, `${ref} is not a reference`);
    return [ref, parsedReference];
  };

  app.get("/api/refs/:ref", async (c) => {
    const found = reference(c);
    if (found instanceof Response) return found;
    const [ref, parsedReference] = found;
    const result = detail(store.db, ref, parsedReference);
    if (!result) return error(c, 404, `${ref} does not exist`);
    const location = result.kind === "task" ? await locateTask?.(ref).catch(() => null) : null;
    return c.json(location ? { ...result, diff: location } : result);
  });

  const exists = (ref: string) => {
    const state = store.state;
    return ref in state.items || ref in state.tasks || ref in state.runs;
  };

  app.get("/api/refs/:ref/events", (c) => {
    const found = reference(c);
    if (found instanceof Response) return found;
    const [ref, parsedReference] = found;
    if (!exists(ref)) return error(c, 404, `${ref} does not exist`);
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
        await stream.writeSSE({ id: String(row.id), event: "event", data: row.line });
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
          data: JSON.stringify(next.event),
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
        "invalid item",
        body.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      );
    return c.json(await commands.addItem(body.data), 201);
  });

  app.post("/api/refs/:ref/:verb", async (c) => {
    const found = reference(c);
    if (found instanceof Response) return found;
    const [ref, parsedReference] = found;
    const verb = verbSchema.safeParse(c.req.param("verb"));
    if (!verb.success) return error(c, 400, `unknown verb ${c.req.param("verb")}`);
    if (!verbsByKind[parsedReference.kind].includes(verb.data)) {
      return error(c, 400, `a ${parsedReference.kind} does not take ${verb.data}`);
    }
    const body = verbBodySchemas[verb.data].safeParse(await jsonBody(c));
    if (!body.success) {
      return error(
        c,
        400,
        `invalid ${verb.data}`,
        body.error.issues.map((i) => `${i.path.join(".") || "<body>"}: ${i.message}`),
      );
    }
    if (!exists(ref)) return error(c, 404, `${ref} does not exist`);
    return c.json(await commands.act(ref, parsedReference, verb.data, body.data));
  });

  app.post("/api/factory/pause", async (c) => c.json(await commands.pauseFactory()));
  app.post("/api/factory/resume", async (c) => c.json(await commands.resumeFactory()));
  app.post("/api/admin/db-rebuild", async (c) => c.json(await commands.rebuildIndex()));
  app.post("/api/admin/install", async (c) => {
    const body = installSchema.safeParse(await jsonBody(c));
    if (!body.success) return error(c, 400, "invalid install", body.error.issues.map(issueText));
    return c.json(await commands.install(body.data));
  });

  app.notFound((c) => error(c, 404, "no such endpoint"));
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
