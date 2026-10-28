import { stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { type Factory, kozoHome, parseCharter, parseConstraints } from "@kozo/core";
import {
  baseOf,
  charterPath,
  constraintsPath,
  type Definition,
  definitionTip,
  GitError,
  git,
  platformConfine,
  readDefinition,
  SandboxUnavailable,
  showFile,
  verifyAppPath,
} from "@kozo/verify";
import { ExitCode, type Lines, UsageError } from "./factory-commands.ts";

type Status = "ok" | "warn" | "fail";

export interface Check {
  name: string;
  status: Status;
  detail: string;
}

// The claude flags behind the Agent SDK options that kozo sets; an older claude lacks some.
const requiredFlags = [
  "--output-format",
  "--input-format",
  "--json-schema",
  "--model",
  "--system-prompt",
  "--allowed-tools",
  "--permission-mode",
  "--setting-sources",
  "--strict-mcp-config",
  "--mcp-config",
  "--max-budget-usd",
  "--no-session-persistence",
];

// The flags `runtime: cli` adds, running each agent as `claude --print`; judges and the verify
// session keep the Agent SDK, so its flags stay required too. claude's help leaves out
// --system-prompt-file, so it cannot be looked for there.
const cliFlags = ["--print", "--verbose", "--settings", "--tools"];

const hooksDetail: Record<Factory["runtime"], string> = {
  sdk: "the worker registers the guard in code and loads no settings file",
  cli: "claude loads only the settings file kozod writes, whose hooks hand every tool call to the worker's guard",
};

/**
 * `kozo check [path]`: checks what the factory needs without kozod. With a path, only the files
 * in that working tree, for CI and pre-commit hooks.
 */
export async function check(args: readonly string[], out: Lines): Promise<number> {
  const { values, positionals } = parseArgs({
    args: [...args],
    options: { json: { type: "boolean" } },
    allowPositionals: true,
  });
  if (positionals.length > 1) throw new UsageError("check takes at most one path");
  const path = positionals[0];
  const checks = path ? await checkPath(resolve(path)) : await checkFactory();
  const ok = !checks.some((entry) => entry.status === "fail");
  if (values.json) out.stdout(JSON.stringify({ ok, checks }));
  else
    for (const entry of checks)
      out.stdout(`${entry.status.padEnd(4)}  ${entry.name}: ${entry.detail}`);
  return ok ? ExitCode.success : ExitCode.failure;
}

const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false,
  );

async function checkPath(directory: string): Promise<Check[]> {
  if ((await exists(join(directory, "factory.yml"))) || (await exists(join(directory, "agents")))) {
    return [definitionCheck(await readDefinition(directory, null), directory)];
  }
  if (await exists(join(directory, ".kozo"))) {
    const read = (path: string) =>
      Bun.file(join(directory, path))
        .text()
        .catch(() => null);
    return documentChecks(
      directory,
      await read(charterPath),
      await read(constraintsPath),
      await exists(join(directory, verifyAppPath)),
    );
  }
  return [
    {
      name: directory,
      status: "fail",
      detail: "neither a factory definition (factory.yml, agents/) nor a repository with .kozo/",
    },
  ];
}

function definitionCheck(result: Awaited<ReturnType<typeof readDefinition>>, where: string): Check {
  if (!result.ok)
    return { name: "factory definition", status: "fail", detail: result.issues.join("; ") };
  const commit = result.definition.commit;
  return {
    name: "factory definition",
    status: "ok",
    detail: commit ? `${where} at ${commit.slice(0, 12)}` : where,
  };
}

/** The Charter, the constraints and verify-app.md of one repository, from their texts. */
function documentChecks(
  repository: string,
  charterText: string | null,
  constraintsText: string | null,
  verifyApp: boolean,
): Check[] {
  const checks: Check[] = [];
  const charter = charterText === null ? null : parseCharter(charterText);
  if (!charter)
    checks.push({
      name: `${repository} Charter`,
      status: "fail",
      detail: `${charterPath} is missing`,
    });
  else if (!charter.ok)
    checks.push({
      name: `${repository} Charter`,
      status: "fail",
      detail: charter.issues.join("; "),
    });
  else if (charter.value.status !== "ready")
    checks.push({
      name: `${repository} Charter`,
      status: "warn",
      detail: `status is ${charter.value.status}; kozo does not work here until it is ready`,
    });
  else checks.push({ name: `${repository} Charter`, status: "ok", detail: "ready" });
  const constraints = constraintsText === null ? null : parseConstraints(constraintsText);
  if (!constraints)
    checks.push({
      name: `${repository} constraints`,
      status: "fail",
      detail: `${constraintsPath} is missing`,
    });
  else if (!constraints.ok)
    checks.push({
      name: `${repository} constraints`,
      status: "fail",
      detail: constraints.issues.join("; "),
    });
  else checks.push({ name: `${repository} constraints`, status: "ok", detail: "valid" });
  checks.push(
    verifyApp
      ? { name: `${repository} verify-app`, status: "ok", detail: verifyAppPath }
      : {
          name: `${repository} verify-app`,
          status: "warn",
          detail: `${verifyAppPath} is missing, so verify does not run`,
        },
  );
  return checks;
}

async function checkFactory(): Promise<Check[]> {
  const home = kozoHome();
  const checks: Check[] = [];
  let definition: Definition | null = null;
  try {
    const tip = await definitionTip(home.factory);
    const result = await readDefinition(home.factory, tip);
    checks.push(definitionCheck(result, home.factory));
    if (result.ok) definition = result.definition;
  } catch (error) {
    if (!(error instanceof GitError)) throw error;
    checks.push({ name: "factory definition", status: "fail", detail: error.message });
  }
  const mode = definition?.factory.mode ?? "local";
  for (const repository of definition?.factory.repositories ?? []) {
    checks.push(...(await repositoryChecks(repository.path, mode)));
  }
  const runtime = definition?.factory.runtime ?? "sdk";
  checks.push(...(await claudeChecks(runtime)));
  checks.push({ name: "hooks", status: "ok", detail: hooksDetail[runtime] });
  checks.push(sandboxCheck(), await kozoSandboxCheck(), processesCheck());
  return checks;
}

/** A repository's documents at the tip of its base as kozod reads it, origin's in GitHub mode. */
async function repositoryChecks(path: string, mode: Factory["mode"]): Promise<Check[]> {
  try {
    const { ref } = await baseOf(path, mode);
    const tip = (await git(path, ["rev-parse", ref])).trim();
    return documentChecks(
      path,
      await showFile(path, tip, charterPath),
      await showFile(path, tip, constraintsPath),
      (await showFile(path, tip, verifyAppPath)) !== null,
    );
  } catch (error) {
    if (!(error instanceof GitError)) throw error;
    return [{ name: path, status: "fail", detail: error.message }];
  }
}

/** Runs claude with `args`, giving up after 20 seconds. */
async function runClaude(claude: string, args: string[]) {
  const child = Bun.spawn([claude, ...args], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    timeout: 20_000,
  });
  const [stdout, code] = await Promise.all([new Response(child.stdout).text(), child.exited]);
  return { stdout, code };
}

async function claudeChecks(runtime: Factory["runtime"]): Promise<Check[]> {
  const claude = process.env.KOZO_CLAUDE ?? Bun.which("claude");
  if (!claude) return [{ name: "claude", status: "fail", detail: "claude is not on PATH" }];
  const version = await runClaude(claude, ["--version"]);
  if (version.code !== 0) {
    return [
      { name: "claude", status: "fail", detail: `${claude} --version exited with ${version.code}` },
    ];
  }
  const checks: Check[] = [
    { name: "claude", status: "ok", detail: version.stdout.trim().split("\n")[0] ?? "" },
  ];
  const help = await runClaude(claude, ["--help"]);
  const flags = runtime === "cli" ? [...requiredFlags, ...cliFlags] : requiredFlags;
  const missing = flags.filter((flag) => !help.stdout.includes(flag));
  checks.push(
    missing.length === 0
      ? { name: "claude flags", status: "ok", detail: "every flag kozo uses is there" }
      : {
          name: "claude flags",
          status: "fail",
          detail: `missing ${missing.join(", ")}; update claude`,
        },
  );
  // Only whether claude is signed in and how is read; kozo never touches the credentials.
  const auth = await runClaude(claude, ["auth", "status", "--json"]);
  let signedIn: { loggedIn?: unknown; authMethod?: unknown } = {};
  try {
    signedIn = JSON.parse(auth.stdout);
  } catch {}
  checks.push(
    signedIn.loggedIn === true
      ? {
          name: "claude sign-in",
          status: "ok",
          detail: `signed in with ${String(signedIn.authMethod)}`,
        }
      : { name: "claude sign-in", status: "fail", detail: "not signed in; run claude auth login" },
  );
  return checks;
}

/** Whether kozod can confine the diff's commands in prepare, the gates and prove. */
async function kozoSandboxCheck(): Promise<Check> {
  try {
    await platformConfine();
    const tool = process.platform === "darwin" ? "sandbox-exec" : "bwrap";
    return { name: "kozo sandbox", status: "ok", detail: `${tool} confines the gates` };
  } catch (error) {
    if (!(error instanceof SandboxUnavailable)) throw error;
    return { name: "kozo sandbox", status: "fail", detail: error.message };
  }
}

/** Whether kozod can list a session's processes, which it does before every session. */
function processesCheck(): Check {
  return Bun.which("lsof")
    ? { name: "lsof", status: "ok", detail: "lists the processes a session leaves" }
    : {
        name: "lsof",
        status: "fail",
        detail: "lsof is not on PATH; kozod needs it to stop what a session leaves running",
      };
}

/** The tools Claude Code's sandbox needs on this platform. */
function sandboxCheck(): Check {
  const tools =
    process.platform === "darwin"
      ? ["sandbox-exec"]
      : process.platform === "linux"
        ? ["bwrap", "socat"]
        : null;
  if (!tools)
    return { name: "sandbox", status: "fail", detail: `no sandbox for ${process.platform}` };
  const missing = tools.filter((tool) => !Bun.which(tool));
  return missing.length === 0
    ? { name: "sandbox", status: "ok", detail: tools.join(", ") }
    : { name: "sandbox", status: "fail", detail: `missing ${missing.join(", ")}` };
}
