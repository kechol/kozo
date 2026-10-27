import { describe, expect, test } from "bun:test";
import type { WorkerSpec } from "@kozo/worker";
import { processLauncher } from "./launcher.ts";

describe("processLauncher", () => {
  test("kills a worker that ignores SIGTERM once the grace has passed", async () => {
    // The worker says it is ready once SIGTERM can no longer stop it.
    const script = `trap '' TERM; echo '{"note":"ready"}'; while :; do sleep 1; done`;
    const session = processLauncher(["sh", "-c", script, "worker"], 500).launch(
      {} as WorkerSpec,
      "/nonexistent/worker.json",
    );
    const messages = session.messages[Symbol.asyncIterator]();
    expect((await messages.next()).value).toEqual({ note: "ready" });
    const started = performance.now();
    session.stop();
    expect((await messages.next()).done).toBe(true);
    const took = performance.now() - started;
    expect(took).toBeGreaterThanOrEqual(400);
    expect(took).toBeLessThan(3_000);
  });
});
