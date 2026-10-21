import { apiPort, type KozoHome, kozoHome } from "@kozo/core";

/** kozod is not running, or has never run in this home. */
export class KozodUnavailable extends Error {}

export interface Answer {
  status: number;
  body: Record<string, unknown> & { error?: string; issues?: string[] };
}

export interface Client {
  readonly home: KozoHome;
  readonly base: string;
  get(path: string): Promise<Answer>;
  post(path: string, body?: unknown): Promise<Answer>;
  /** Opens an SSE stream; the response body is the raw event stream. */
  stream(path: string, lastEventId?: number): Promise<Response>;
}

export function apiPortFromEnvironment(): number {
  return Number(process.env.KOZO_PORT ?? apiPort);
}

/** A client of the local API, authenticated with the home's token. */
export async function connect(home = kozoHome()): Promise<Client> {
  const tokenFile = Bun.file(home.apiToken);
  if (!(await tokenFile.exists())) {
    throw new KozodUnavailable("kozod has not run in this home yet; start it with kozo up");
  }
  const token = (await tokenFile.text()).trim();
  const base = `http://127.0.0.1:${apiPortFromEnvironment()}`;
  const request = async (path: string, init: RequestInit = {}) => {
    try {
      return await fetch(`${base}${path}`, {
        ...init,
        headers: { authorization: `Bearer ${token}`, ...init.headers },
      });
    } catch {
      throw new KozodUnavailable("kozod is not running; start it with kozo up");
    }
  };
  const answer = async (response: Response): Promise<Answer> => ({
    status: response.status,
    body: (await response.json()) as Answer["body"],
  });
  return {
    home,
    base,
    get: async (path) => answer(await request(path)),
    post: async (path, body = {}) =>
      answer(
        await request(path, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
      ),
    stream: (path, lastEventId = 0) =>
      request(path, { headers: { "last-event-id": String(lastEventId) } }),
  };
}

/** The path segment of a reference; a task reference holds a slash and an item may hold a #. */
export const refPath = (ref: string) => `/api/refs/${encodeURIComponent(ref)}`;
