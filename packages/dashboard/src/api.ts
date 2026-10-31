import type { ApiError as ApiErrorBody, Event, Verb } from "@kozo/core";

/** Where the page keeps its session token: this tab's session, never the URL or other tabs. */
const tokenKey = "kozo.session";

/**
 * The tab's session token. A page that `kozo dashboard` opened with a code in the URL fragment
 * takes the code out of the address at once and trades it for a session token, which it keeps
 * in the tab's session storage; a code that fails leaves the tab without a session.
 */
export async function takeSession(
  location: { hash: string; pathname: string; search: string },
  storage: Pick<Storage, "getItem" | "setItem">,
  replace: (url: string) => void,
  trade: (code: string) => Promise<string | null>,
): Promise<string | null> {
  const match = /^#code=([0-9a-f]{64})$/.exec(location.hash);
  if (match?.[1]) {
    replace(`${location.pathname}${location.search}#/`);
    const token = await trade(match[1]);
    if (token) storage.setItem(tokenKey, token);
  }
  return storage.getItem(tokenKey);
}

/** Forgets the tab's session token once kozod no longer takes it. */
export function endSession(storage: Pick<Storage, "removeItem">): void {
  storage.removeItem(tokenKey);
}

/** Trades a code for a session token with kozod, or null when kozod refuses it. */
export async function tradeCode(code: string): Promise<string | null> {
  const response = await fetch("/api/dashboard/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code }),
  });
  if (!response.ok) return null;
  return ((await response.json()) as { token?: string }).token ?? null;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly issues: readonly string[] = [],
  ) {
    super(message);
  }
}

export interface Status {
  mode: "local" | "github";
  paused: boolean;
  pausedReason: string | null;
  activeRuns: number;
  waiting: number;
  costTodayUsd: number;
  repositories: string[];
}

export interface InboxRow {
  kind: "item" | "task";
  ref: string;
  title: string;
  waiting: "approval" | "question" | "attention" | "merge";
  reason: string | null;
  /** Which approval a row waiting for one waits for. */
  approval: "start" | "plan" | null;
  since: string;
}

export interface ItemRow {
  ref: string;
  repository: string;
  title: string;
  stage: string;
  shown_stage: string;
  hold: string | null;
  hold_reason: string | null;
  updated_at: string;
  /** The plan's work class, or the draft's, once triage has one. */
  class: string | null;
  /** The autonomy level the item runs at, or null when the Charter cannot be read. */
  level: string | null;
}

export interface TaskRow {
  ref: string;
  item: string;
  goal: string;
  stage: string;
  hold: string | null;
  hold_reason: string | null;
  revisions: number;
  updated_at: string;
}

export interface RunRow {
  ref: string;
  item: string;
  task: string | null;
  agent: string;
  model: string;
  state: string;
  started_at: string;
  ended_at: string | null;
}

export interface VerbAnswer {
  message: string;
  awaitingHuman?: boolean;
}

/** The local API, as the page reaches it with the tab's token. */
export class Api {
  constructor(
    private readonly token: string,
    // Called through the window, since a browser's fetch refuses any other `this`.
    private readonly fetcher: (input: string, init?: RequestInit) => Promise<Response> = (
      input,
      init,
    ) => fetch(input, init),
  ) {}

  /** A request to the API with the tab's session. */
  private send(path: string, init: RequestInit = {}): Promise<Response> {
    return this.fetcher(path, {
      ...init,
      headers: { authorization: `Bearer ${this.token}`, ...init.headers },
    });
  }

  private async request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const response = await this.send(path, {
      method,
      ...(body === undefined
        ? {}
        : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    });
    const answer = (await response.json().catch(() => ({}))) as T & Partial<ApiErrorBody>;
    if (!response.ok) {
      throw new ApiError(
        response.status,
        answer.error ?? `kozod answered ${response.status}`,
        answer.issues ?? [],
      );
    }
    return answer;
  }

  get<T>(path: string): Promise<T> {
    return this.request<T>("GET", path);
  }

  /** A file the API serves, such as a piece of evidence, as a blob the page can show. */
  async blob(path: string): Promise<Blob> {
    const response = await this.send(path);
    if (!response.ok) throw new ApiError(response.status, `kozod answered ${response.status}`);
    return await response.blob();
  }

  act(ref: string, verb: Verb, body: Record<string, unknown> = {}): Promise<VerbAnswer> {
    return this.request("POST", `/api/refs/${encodeURIComponent(ref)}/${verb}`, body);
  }

  post(path: string, body: Record<string, unknown> = {}): Promise<VerbAnswer> {
    return this.request("POST", path, body);
  }

  /**
   * Follows a reference's events from the first on until `signal` aborts. The SSE endpoint is
   * read with fetch, since EventSource cannot send the token.
   */
  /**
   * Follows the events of `ref` until `signal` aborts. When the stream ends or breaks, as when
   * kozod starts again, it connects again after a pause that doubles up to `pauses.max`, from
   * the last event it gave, so that none is missed or given twice. An answer that refuses the
   * request, such as for a session that ended, ends the following.
   */
  async follow(
    ref: string,
    onEvent: (event: Event) => void,
    signal: AbortSignal,
    pauses = { first: 1_000, max: 30_000 },
  ) {
    let last = 0;
    let pause = pauses.first;
    while (!signal.aborted) {
      try {
        const response = await this.send(`/api/refs/${encodeURIComponent(ref)}/events`, {
          signal,
          ...(last > 0 ? { headers: { "last-event-id": String(last) } } : {}),
        });
        if (response.status >= 400 && response.status < 500)
          throw new ApiError(response.status, "no event stream");
        if (response.ok && response.body) {
          pause = pauses.first;
          await readEvents(response.body, (id, event) => {
            last = id;
            onEvent(event);
          });
        }
      } catch (error) {
        if (error instanceof ApiError || signal.aborted) throw error;
      }
      if (signal.aborted) return;
      await new Promise((resolve) => setTimeout(resolve, pause));
      pause = Math.min(pause * 2, pauses.max);
    }
  }
}

/** Reads an event stream to its end, giving each event with its ID. */
async function readEvents(
  body: ReadableStream<BufferSource>,
  onEvent: (id: number, event: Event) => void,
) {
  const reader = body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buffer += value;
    for (let end = buffer.indexOf("\n\n"); end !== -1; end = buffer.indexOf("\n\n")) {
      const lines = buffer.slice(0, end).split("\n");
      buffer = buffer.slice(end + 2);
      const field = (name: string) =>
        lines
          .filter((line) => line.startsWith(`${name}:`))
          .map((line) => line.slice(name.length + 1).trimStart())
          .join("\n");
      const data = field("data");
      if (data) onEvent(Number(field("id")) || 0, JSON.parse(data) as Event);
    }
  }
}
