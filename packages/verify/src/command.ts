import { type CommandSandbox, type Confine, withSandboxTemp } from "./sandbox.ts";

/** A sandbox and the way to confine a command to it. */
export interface Confined {
  confine: Confine;
  sandbox: CommandSandbox;
}

/**
 * Runs `command` through `sh -c` in `cwd`, passing its output to `log`, and returns its exit
 * code. Without `env` the command inherits this process's environment. With `confined` it runs
 * in that sandbox, with a temporary directory of its own as TMPDIR.
 */
export async function runCommand(
  command: string,
  cwd: string,
  log: (text: string) => void,
  env?: Record<string, string>,
  confined?: Confined,
) {
  const run = async (argv: string[], environment = env) => {
    const child = Bun.spawn(argv, {
      cwd,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      ...(environment ? { env: environment } : {}),
    });
    await Promise.all([forward(child.stdout, log), forward(child.stderr, log)]);
    return await child.exited;
  };
  if (!confined) return await run(["sh", "-c", command]);
  return await withSandboxTemp(confined.sandbox, (sandbox, temp) =>
    run(confined.confine(sandbox, ["sh", "-c", command]), {
      ...(env ?? (process.env as Record<string, string>)),
      TMPDIR: temp,
    }),
  );
}

async function forward(stream: ReadableStream<Uint8Array>, log: (text: string) => void) {
  const decoder = new TextDecoder();
  for await (const chunk of stream) log(decoder.decode(chunk, { stream: true }));
  const rest = decoder.decode();
  if (rest) log(rest);
}

/** The lines a stream ends with a newline, trimmed, leaving out empty ones. */
export async function* lines(stream: AsyncIterable<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of stream) {
    buffer += decoder.decode(chunk, { stream: true });
    let end = buffer.indexOf("\n");
    while (end >= 0) {
      const line = buffer.slice(0, end).trim();
      buffer = buffer.slice(end + 1);
      if (line) yield line;
      end = buffer.indexOf("\n");
    }
  }
}

/**
 * Writes to a socket in order, keeping what it could not take until its drain handler calls
 * `drain`, so a large message is not cut short.
 */
export class Outbox {
  private queue: Uint8Array[] = [];
  private ending = false;
  constructor(private readonly socket: { write(bytes: Uint8Array): number; end(): unknown }) {}

  write(bytes: Uint8Array) {
    this.queue.push(bytes);
    this.drain();
  }

  /** Ends the socket once everything written has gone. */
  end() {
    this.ending = true;
    this.drain();
  }

  drain() {
    while (this.queue.length > 0) {
      const next = this.queue[0] as Uint8Array;
      const written = this.socket.write(next);
      if (written < next.length) {
        this.queue[0] = next.subarray(Math.max(written, 0));
        return;
      }
      this.queue.shift();
    }
    if (this.ending) {
      this.ending = false;
      this.socket.end();
    }
  }
}

/** `text` as one word of a `sh` command line. */
export function shellQuote(text: string) {
  return `'${text.replaceAll("'", `'\\''`)}'`;
}

export function secondsSince(start: number) {
  return Math.round((performance.now() - start) / 1000);
}

type ErrorClass = abstract new (...args: never[]) => Error;

/**
 * Runs a verification layer, turning the errors it expects, such as a failed git call, into its
 * `error` status; anything else is a bug in kozo and is thrown on.
 */
export async function guarded<T>(
  log: (text: string) => void,
  expected: readonly ErrorClass[],
  layer: () => Promise<T>,
): Promise<T | { status: "error"; message: string }> {
  try {
    return await layer();
  } catch (error) {
    if (!expected.some((type) => error instanceof type)) throw error;
    const { message } = error as Error;
    log(`kozo: ${message}\n`);
    return { status: "error", message };
  }
}

// What a gate or a test needs from the environment. Sign-in variables, tokens and cloud
// credentials stay with kozod, since the commands run code from the diff under check.
const commandEnvironment = [
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "TMPDIR",
  "LANG",
  "LC_ALL",
  "TERM",
];

/** The variables of `source` named in `names`, leaving out the unset ones. */
export function pickEnvironment(
  source: Record<string, string | undefined>,
  names: readonly string[],
): Record<string, string> {
  return Object.fromEntries(
    names.flatMap((name) => {
      const value = source[name];
      return value === undefined ? [] : [[name, value]];
    }),
  );
}

/** The environment kozod runs a diff's commands with: `source` without any credential. */
export const commandEnvironmentFrom = (source: Record<string, string | undefined>) =>
  pickEnvironment(source, commandEnvironment);
