import { readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { apiPort, kozoHome } from "@kozo/core";
import {
  claudeJudge,
  claudeVerifier,
  definitionTip,
  platformConfine,
  readDefinition,
} from "@kozo/verify";
import { claudeAgentFor, hookMain, mcpMain, readBridgeToken, workerMain } from "@kozo/worker";
import pkg from "../package.json" with { type: "json" };
import { Daemon, kozodCommand } from "./daemon.ts";
import { EgressProxy, hostAllowed } from "./egress.ts";
import { type EvalResult, runEvalCase } from "./eval.ts";
import { processLauncher } from "./launcher.ts";

export const ExitCode = { success: 0, failure: 1, usage: 2 } as const;

export interface Output {
  stdout(text: string): void;
  stderr(text: string): void;
}

const USAGE = `Usage: kozod [options]

Runs kozod in the foreground until it receives SIGINT or SIGTERM, or until its event store
refuses writes, when it exits with status 1.

Options:
  --version        Print the version
  --worker <spec>  Run one agent session for kozod (internal)
  --hook <socket>  Pass a hook of a claude -p session to its worker (internal)
  --mcp <socket>   Serve a claude -p session the worker's tools over stdio (internal)
  --eval [<case>...]
                   Run the factory definition's eval cases, or the named ones, each in
                   a throwaway factory home, and print the results as JSON`;

/** Starts kozod and resolves once it has stopped again. */
async function serve(out: Output): Promise<number> {
  let daemon: Daemon;
  try {
    daemon = await Daemon.start();
  } catch (error) {
    out.stderr(`kozod: ${(error as Error).message}`);
    return ExitCode.failure;
  }
  out.stdout(`kozod ${pkg.version} listening on http://127.0.0.1:${daemon.port}`);
  const failure = await new Promise<Error | null>((resolve) => {
    process.once("SIGINT", () => resolve(null));
    process.once("SIGTERM", () => resolve(null));
    void daemon.failure.then(resolve);
  });
  await daemon.stop();
  if (failure === null) return ExitCode.success;
  out.stderr(`kozod: ${failure.message}`);
  return ExitCode.failure;
}

/** The body of an upstream GitHub issue, read with gh. */
async function issueBody(url: string): Promise<string> {
  const match = url.match(/^https:\/\/github\.com\/([^/]+\/[^/]+)\/issues\/(\d+)$/);
  if (!match) throw new Error(`${url} is not a GitHub issue`);
  const child = Bun.spawn(["gh", "api", `repos/${match[1]}/issues/${match[2]}`, "--jq", ".body"], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [body, code] = await Promise.all([new Response(child.stdout).text(), child.exited]);
  if (code !== 0) throw new Error(`gh could not read ${url}`);
  return body.replace(/\n$/, "");
}

/**
 * Runs the factory definition's eval cases, or the named ones, and prints each result and the
 * share that reached the expected outcome as one JSON document; progress goes to stderr.
 */
async function evaluate(names: readonly string[], out: Output): Promise<number> {
  const home = kozoHome();
  const loaded = await readDefinition(
    home.factory,
    await definitionTip(home.factory).catch(() => null),
  );
  if (!loaded.ok) {
    out.stderr(`kozod: the factory definition does not load: ${loaded.issues.join("; ")}`);
    return ExitCode.failure;
  }
  const dir = join(home.factory, "evals");
  const files =
    names.length > 0
      ? names.map((name) => join(dir, name.endsWith(".yml") ? name : `${name}.yml`))
      : (await readdir(dir).catch(() => []))
          .filter((name) => name.endsWith(".yml"))
          .sort()
          .map((name) => join(dir, name));
  const claude = process.env.KOZO_CLAUDE ?? Bun.which("claude") ?? "claude";
  const egress = EgressProxy.start(
    (host) => hostAllowed(host, loaded.definition.factory.prepare_hosts ?? []),
    (line) => out.stderr(line),
  );
  const deps = {
    egress,
    launcher: processLauncher(kozodCommand()),
    judge: claudeJudge(claude),
    verifier: claudeVerifier(claude, home.root),
    confine: await platformConfine(),
    apiPort: Number(process.env.KOZO_PORT ?? apiPort),
    issueBody,
  };
  const cases: EvalResult[] = [];
  try {
    for (const file of files) {
      out.stderr(`kozod: eval ${basename(file, ".yml")}`);
      const result = await runEvalCase(file, loaded.definition, deps, (line) => out.stderr(line));
      out.stderr(
        `kozod: eval ${result.id}: ${result.outcome}, ${result.passed ? "as expected" : `expected ${result.expected}`}`,
      );
      cases.push(result);
    }
  } finally {
    egress.stop();
  }
  const passed = cases.filter((result) => result.passed).length;
  out.stdout(
    JSON.stringify({
      cases,
      passed,
      total: cases.length,
      share: cases.length === 0 ? null : passed / cases.length,
      costUsd: cases.reduce((sum, result) => sum + result.costUsd, 0),
    }),
  );
  return passed === cases.length ? ExitCode.success : ExitCode.failure;
}

export async function run(args: readonly string[], out: Output): Promise<number> {
  const [option] = args;
  if (option === undefined) return await serve(out);
  if (option === "--eval") return await evaluate(args.slice(1), out);
  if (option === "--worker" && args[1]) {
    return await workerMain(args[1], out.stdout, (spec) =>
      claudeAgentFor(spec.runtime, kozodCommand()),
    );
  }
  if (option === "--hook" && args[1]) {
    const token = await readBridgeToken(args[1]);
    return await hookMain(args[1], token, await Bun.stdin.text(), out.stdout, out.stderr);
  }
  if (option === "--mcp" && args[1]) {
    const token = await readBridgeToken(args[1]);
    return await mcpMain(args[1], token, Bun.stdin.stream(), out.stdout);
  }
  if (option === "--version") {
    out.stdout(`kozod ${pkg.version}`);
    return ExitCode.success;
  }
  out.stderr(`kozod: unknown option '${option}'\n\n${USAGE}`);
  return ExitCode.usage;
}

export { Daemon } from "./daemon.ts";
