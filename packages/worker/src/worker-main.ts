import { claudeAgent } from "./claude-agent.ts";
import type { CodingAgent } from "./coding-agent.ts";
import { runSession, workerSpecSchema } from "./session.ts";

/**
 * The worker process: runs the session described by the spec at `specPath` and writes each
 * message to kozod as one JSON line, ending with the outcome. SIGTERM stops the session.
 */
export async function workerMain(
  specPath: string,
  write: (line: string) => void,
  agent: CodingAgent = claudeAgent(process.env.KOZO_CLAUDE ?? Bun.which("claude") ?? "claude"),
): Promise<number> {
  const spec = workerSpecSchema.parse(JSON.parse(await Bun.file(specPath).text()));
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGTERM", stop);
  try {
    const outcome = await runSession(
      spec,
      agent,
      (message) => write(JSON.stringify(message)),
      controller.signal,
    );
    write(JSON.stringify({ outcome }));
    return 0;
  } finally {
    process.off("SIGTERM", stop);
  }
}
