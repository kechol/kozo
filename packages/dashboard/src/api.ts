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
}

export interface InboxRow {
  kind: "item" | "task";
  ref: string;
  title: string;
  waiting: "approval" | "question" | "attention" | "merge";
  reason: string | null;
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

  private async request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const response = await this.fetcher(path, {
      method,
      headers: {
        authorization: `Bearer ${this.token}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
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
  async follow(ref: string, onEvent: (event: Event) => void, signal: AbortSignal) {
    const response = await this.fetcher(`/api/refs/${encodeURIComponent(ref)}/events`, {
      headers: { authorization: `Bearer ${this.token}` },
      signal,
    });
    if (!response.ok || !response.body) throw new ApiError(response.status, "no event stream");
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      buffer += value;
      for (let end = buffer.indexOf("\n\n"); end !== -1; end = buffer.indexOf("\n\n")) {
        const block = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const data = block
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        if (data) onEvent(JSON.parse(data) as Event);
      }
    }
  }
}
