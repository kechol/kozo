import { sessionEnvironmentFrom } from "@kozo/verify";
import { type CodingAgent, runSession, type WorkerMessage, type WorkerSpec } from "@kozo/worker";

/** One agent session that kozod started, whose messages it reads until the outcome. */
export interface LaunchedSession {
  /** Every message the worker sends, ending with its outcome unless the worker dies first. */
  messages: AsyncIterable<WorkerMessage>;
  /** Asks the session to stop; it ends with a stopped outcome. */
  stop(): void;
}

export interface Launcher {
  launch(spec: WorkerSpec, specPath: string): LaunchedSession;
}

/**
 * Starts each session in its own worker process: kozod's own executable with `--worker`. The
 * worker gets only the variables claude needs to run and to sign in, so no GitHub token or
 * other credential reaches it.
 */
export function processLauncher(command: readonly string[]): Launcher {
  return {
    launch(_spec, specPath) {
      const child = Bun.spawn([...command, "--worker", specPath], {
        stdin: "ignore",
        stdout: "pipe",
        stderr: "inherit",
        env: {
          ...sessionEnvironmentFrom(process.env),
          ...(process.env.KOZO_CLAUDE ? { KOZO_CLAUDE: process.env.KOZO_CLAUDE } : {}),
        },
      });
      async function* messages(): AsyncGenerator<WorkerMessage> {
        const decoder = new TextDecoder();
        let buffer = "";
        for await (const chunk of child.stdout) {
          buffer += decoder.decode(chunk, { stream: true });
          let end = buffer.indexOf("\n");
          while (end >= 0) {
            const line = buffer.slice(0, end).trim();
            buffer = buffer.slice(end + 1);
            if (line.startsWith("{")) yield JSON.parse(line) as WorkerMessage;
            end = buffer.indexOf("\n");
          }
        }
        await child.exited;
      }
      return { messages: messages(), stop: () => child.kill("SIGTERM") };
    },
  };
}

/** Runs each session inside kozod with the given agent, as tests do with the fake agent. */
export function inProcessLauncher(agent: CodingAgent): Launcher {
  return {
    launch(spec) {
      const controller = new AbortController();
      const queue: WorkerMessage[] = [];
      let wake: (() => void) | null = null;
      let done = false;
      const push = (message: WorkerMessage) => {
        queue.push(message);
        wake?.();
      };
      runSession(spec, agent, push, controller.signal).then(
        (outcome) => {
          push({ outcome });
          done = true;
          wake?.();
        },
        (error: unknown) => {
          push({ outcome: { status: "failed", reason: String(error), costUsd: 0, turns: 0 } });
          done = true;
          wake?.();
        },
      );
      async function* messages(): AsyncGenerator<WorkerMessage> {
        for (;;) {
          const next = queue.shift();
          if (next) {
            yield next;
            continue;
          }
          if (done) return;
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
          wake = null;
        }
      }
      return { messages: messages(), stop: () => controller.abort() };
    },
  };
}
