import type { Message } from "@kozo/core";
import { type CommandSandbox, type Confine, withSandboxTemp } from "./sandbox.ts";

/** A sandbox and the way to confine a command to it. */
export interface Confined {
  confine: Confine;
  sandbox: CommandSandbox;
}

/**
 * When a command must stop with everything it started: once `minutes` pass, or once `signal`
 * aborts.
 */
export interface CommandLimit {
  minutes?: number;
  signal?: AbortSignal;
}

/** The exit code of a command stopped at its time limit, as timeout(1) reports one. */
export const outOfTimeCode = 124;

/** Thrown by `runCommand` for a command its limit's signal stopped. */
export class CommandStopped extends Error {
  constructor(command: string) {
    super(`${command} was stopped`);
  }
}

/**
 * Runs `command` through `sh -c` in `cwd`, passing its output to `log`, and returns its exit
 * code. Without `env` the command inherits this process's environment. With `confined` it runs
 * in that sandbox, with a temporary directory of its own as TMPDIR. With `limit` it runs in a
 * process group of its own, which gets SIGTERM when the limit is reached and SIGKILL 10 seconds
 * later: a command out of time fails with `outOfTimeCode`, and a stopped one throws
 * `CommandStopped`.
 */
export async function runCommand(
  command: string,
  cwd: string,
  log: (text: string) => void,
  env?: Record<string, string>,
  confined?: Confined,
  limit?: CommandLimit,
) {
  const run = async (argv: string[], environment = env) => {
    const child = Bun.spawn(argv, {
      cwd,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      detached: limit !== undefined,
      ...(environment ? { env: environment } : {}),
    });
    const output = Promise.all([forward(child.stdout, log), forward(child.stderr, log)]);
    const finished = output.then(() => child.exited);
    if (!limit) return await finished;
    const reached = limitReached(limit);
    const first = await Promise.race([
      finished.then((code) => ({ code })),
      reached.promise.then((why) => ({ why })),
    ]).finally(reached.clear);
    if ("code" in first) return first.code;
    signalGroup(child.pid, "SIGTERM");
    await within(child.exited, 10_000);
    signalGroup(child.pid, "SIGKILL");
    // A process that left the group may still hold the output open.
    await within(output, 1_000);
    if (first.why === "stopped") {
      log(`\nkozo: ${command} was stopped\n`);
      throw new CommandStopped(command);
    }
    log(`\nkozo: ${command} ran out of time after ${limit.minutes} minutes\n`);
    return outOfTimeCode;
  };
  if (!confined) return await run(["sh", "-c", command]);
  return await withSandboxTemp(confined.sandbox, (sandbox, temp) =>
    run(confined.confine(sandbox, ["sh", "-c", command]), {
      ...(env ?? (process.env as Record<string, string>)),
      TMPDIR: temp,
    }),
  );
}

/** Resolves once `limit` is reached, and `clear` lets go of its timer and listener. */
function limitReached({ minutes, signal }: CommandLimit) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stop = () => {};
  const promise = new Promise<"time" | "stopped">((resolve) => {
    stop = () => resolve("stopped");
    if (minutes !== undefined) timer = setTimeout(() => resolve("time"), minutes * 60_000);
    if (signal?.aborted) stop();
    else signal?.addEventListener("abort", stop, { once: true });
  });
  return {
    promise,
    clear() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", stop);
    },
  };
}

/** What `promise` resolves to, or undefined once `ms` pass first. */
async function within<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), ms);
  });
  try {
    return await Promise.race([promise, late]);
  } finally {
    clearTimeout(timer);
  }
}

function signalGroup(pid: number, signal: NodeJS.Signals) {
  try {
    process.kill(-pid, signal);
  } catch {
    // The group has ended.
  }
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
): Promise<T | { status: "error"; message: string; reason?: Message }> {
  try {
    return await layer();
  } catch (error) {
    if (!expected.some((type) => error instanceof type)) throw error;
    const { message, reason } = error as Error & { reason?: Message };
    log(`kozo: ${message}\n`);
    return { status: "error", message, ...(reason ? { reason } : {}) };
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
