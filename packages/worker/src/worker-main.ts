import { type Confine, platformConfine } from "@kozo/verify";
import { claudeAgent } from "./claude-agent.ts";
import { claudeCliAgent } from "./claude-cli-agent.ts";
import type { CodingAgent } from "./coding-agent.ts";
import { runSession, type WorkerSpec, workerSpecSchema } from "./session.ts";

/**
 * The agent for the spec's runtime with the user's own `claude`; `helper` is kozod's own
 * executable, which a CLI session runs for its hooks and tools.
 */
export function claudeAgentFor(runtime: WorkerSpec["runtime"], helper: readonly string[]) {
  const claude = process.env.KOZO_CLAUDE ?? Bun.which("claude") ?? "claude";
  return runtime === "cli" ? claudeCliAgent(claude, helper) : claudeAgent(claude);
}

/**
 * The worker process: runs the session described by the spec at `specPath` and writes each
 * message to kozod as one JSON line, ending with the outcome. SIGTERM stops the session.
 */
export async function workerMain(
  specPath: string,
  write: (line: string) => void,
  agentFor: (spec: WorkerSpec) => CodingAgent,
  confine?: Confine,
): Promise<number> {
  const spec = workerSpecSchema.parse(JSON.parse(await Bun.file(specPath).text()));
  const agent = agentFor(spec);
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGTERM", stop);
  try {
    const outcome = await runSession(
      spec,
      agent,
      (message) => write(JSON.stringify(message)),
      controller.signal,
      confine ?? (await platformConfine()),
    );
    write(JSON.stringify({ outcome }));
    return 0;
  } finally {
    process.off("SIGTERM", stop);
  }
}
