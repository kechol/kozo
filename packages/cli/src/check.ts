import { stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  type Factory,
  kozoHome,
  type MessageCode,
  parseCharter,
  parseConstraints,
} from "@kozo/core";
import {
  activeGitHubLogin,
  baseOf,
  charterPath,
  constraintsPath,
  type Definition,
  definitionTip,
  GitError,
  git,
  githubSignInArgs,
  platformConfine,
  readDefinition,
  SandboxUnavailable,
  showFile,
  verifyAppPath,
} from "@kozo/verify";
import { ExitCode, type Lines, UsageError } from "./factory-commands.ts";
import { english, type Words } from "./words.ts";

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

const hooksDetail = {
  sdk: "cli.check-hooks-sdk",
  cli: "cli.check-hooks-cli",
} as const satisfies Record<Factory["runtime"], MessageCode>;

/**
 * `kozo check [path]`: checks what the factory needs without kozod. With a path, only the files
 * in that working tree, for CI and pre-commit hooks.
 */
export async function check(
  args: readonly string[],
  out: Lines,
  t: Words = english,
): Promise<number> {
  const { values, positionals } = parseArgs({
    args: [...args],
    options: { json: { type: "boolean" } },
    allowPositionals: true,
  });
  if (positionals.length > 1) throw new UsageError(t("cli.check-takes-path"));
  const path = positionals[0];
  const checks = path ? await checkPath(resolve(path), t) : await checkFactory(t);
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

async function checkPath(directory: string, t: Words): Promise<Check[]> {
  if ((await exists(join(directory, "factory.yml"))) || (await exists(join(directory, "agents")))) {
    return [definitionCheck(await readDefinition(directory, null, t.locale), directory, t)];
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
      t,
    );
  }
  return [
    {
      name: directory,
      status: "fail",
      detail: t("cli.check-neither"),
    },
  ];
}

function definitionCheck(
  result: Awaited<ReturnType<typeof readDefinition>>,
  where: string,
  t: Words,
): Check {
  if (!result.ok)
    return { name: "factory definition", status: "fail", detail: result.issues.join("; ") };
  const commit = result.definition.commit;
  return {
    name: "factory definition",
    status: "ok",
    detail: commit ? t("cli.check-at-commit", { where, commit: commit.slice(0, 12) }) : where,
  };
}

/** The Charter, the constraints and verify-app.md of one repository, from their texts. */
function documentChecks(
  repository: string,
  charterText: string | null,
  constraintsText: string | null,
  verifyApp: boolean,
  t: Words,
): Check[] {
  const checks: Check[] = [];
  const charter = charterText === null ? null : parseCharter(charterText, t.locale);
  if (!charter)
    checks.push({
      name: `${repository} Charter`,
      status: "fail",
      detail: t("cli.check-missing", { path: charterPath }),
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
      detail: t("cli.check-charter-status", { status: charter.value.status }),
    });
  else checks.push({ name: `${repository} Charter`, status: "ok", detail: t("cli.check-ready") });
  const constraints = constraintsText === null ? null : parseConstraints(constraintsText, t.locale);
  if (!constraints)
    checks.push({
      name: `${repository} constraints`,
      status: "fail",
      detail: t("cli.check-missing", { path: constraintsPath }),
    });
  else if (!constraints.ok)
    checks.push({
      name: `${repository} constraints`,
      status: "fail",
      detail: constraints.issues.join("; "),
    });
  else
    checks.push({ name: `${repository} constraints`, status: "ok", detail: t("cli.check-valid") });
  checks.push(
    verifyApp
      ? { name: `${repository} verify-app`, status: "ok", detail: verifyAppPath }
      : {
          name: `${repository} verify-app`,
          status: "warn",
          detail: t("cli.check-verify-app-missing", { path: verifyAppPath }),
        },
  );
  return checks;
}

async function checkFactory(t: Words): Promise<Check[]> {
  const home = kozoHome();
  const checks: Check[] = [];
  let definition: Definition | null = null;
  try {
    const tip = await definitionTip(home.factory);
    const result = await readDefinition(home.factory, tip, t.locale);
    checks.push(definitionCheck(result, home.factory, t));
    if (result.ok) definition = result.definition;
  } catch (error) {
    if (!(error instanceof GitError)) throw error;
    checks.push({ name: "factory definition", status: "fail", detail: error.message });
  }
  const mode = definition?.factory.mode ?? "local";
  for (const repository of definition?.factory.repositories ?? []) {
    checks.push(...(await repositoryChecks(repository.path, mode, t)));
  }
  const runtime = definition?.factory.runtime ?? "sdk";
  checks.push(...(await claudeChecks(runtime, t)));
  if (mode === "github") checks.push(await ghCheck(t));
  checks.push({ name: "hooks", status: "ok", detail: t(hooksDetail[runtime]) });
  checks.push(sandboxCheck(t), await kozoSandboxCheck(t), processesCheck(t));
  return checks;
}

/** A repository's documents at the tip of its base as kozod reads it, origin's in GitHub mode. */
async function repositoryChecks(path: string, mode: Factory["mode"], t: Words): Promise<Check[]> {
  try {
    const { ref } = await baseOf(path, mode);
    const tip = (await git(path, ["rev-parse", ref])).trim();
    return documentChecks(
      path,
      await showFile(path, tip, charterPath),
      await showFile(path, tip, constraintsPath),
      (await showFile(path, tip, verifyAppPath)) !== null,
      t,
    );
  } catch (error) {
    if (!(error instanceof GitError)) throw error;
    return [{ name: path, status: "fail", detail: error.message }];
  }
}

/** Runs a tool such as claude or gh with `args`, giving up after 20 seconds. */
async function runTool(tool: string, args: string[]) {
  const child = Bun.spawn([tool, ...args], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    timeout: 20_000,
  });
  const [stdout, code] = await Promise.all([new Response(child.stdout).text(), child.exited]);
  return { stdout, code };
}

async function claudeChecks(runtime: Factory["runtime"], t: Words): Promise<Check[]> {
  const claude = process.env.KOZO_CLAUDE ?? Bun.which("claude");
  if (!claude) return [{ name: "claude", status: "fail", detail: t("cli.check-claude-missing") }];
  const version = await runTool(claude, ["--version"]);
  if (version.code !== 0) {
    return [
      {
        name: "claude",
        status: "fail",
        detail: t("cli.exited-with", { command: `${claude} --version`, code: version.code }),
      },
    ];
  }
  const checks: Check[] = [
    { name: "claude", status: "ok", detail: version.stdout.trim().split("\n")[0] ?? "" },
  ];
  const help = await runTool(claude, ["--help"]);
  const flags = runtime === "cli" ? [...requiredFlags, ...cliFlags] : requiredFlags;
  const missing = flags.filter((flag) => !help.stdout.includes(flag));
  checks.push(
    missing.length === 0
      ? { name: t("cli.check-name-flags"), status: "ok", detail: t("cli.check-flags-ok") }
      : {
          name: t("cli.check-name-flags"),
          status: "fail",
          detail: t("cli.check-flags-missing", { flags: missing.join(", ") }),
        },
  );
  // Only whether claude is signed in and how is read; kozo never touches the credentials.
  const auth = await runTool(claude, ["auth", "status", "--json"]);
  let signedIn: { loggedIn?: unknown; authMethod?: unknown } = {};
  try {
    signedIn = JSON.parse(auth.stdout);
  } catch {}
  checks.push(
    signedIn.loggedIn === true
      ? {
          name: t("cli.check-name-sign-in"),
          status: "ok",
          detail: t("cli.check-signed-in", { method: String(signedIn.authMethod) }),
        }
      : {
          name: t("cli.check-name-sign-in"),
          status: "fail",
          detail: t("cli.check-not-signed-in"),
        },
  );
  return checks;
}

/**
 * In GitHub mode, whether gh is signed in to github.com, as kozod reads it: kozod reaches GitHub
 * only through gh's active sign-in.
 */
async function ghCheck(t: Words): Promise<Check> {
  const gh = Bun.which("gh");
  if (!gh)
    return {
      name: t("cli.check-name-gh"),
      status: "fail",
      detail: t("cli.check-gh-missing"),
    };
  const login = activeGitHubLogin((await runTool(gh, githubSignInArgs)).stdout);
  return login
    ? {
        name: t("cli.check-name-gh"),
        status: "ok",
        detail: t("cli.check-gh-signed-in", { login }),
      }
    : {
        name: t("cli.check-name-gh"),
        status: "fail",
        detail: t("cli.check-gh-not-signed-in"),
      };
}

/** Whether kozod can confine the diff's commands in prepare, the gates and prove. */
async function kozoSandboxCheck(t: Words): Promise<Check> {
  try {
    await platformConfine();
    const tool = process.platform === "darwin" ? "sandbox-exec" : "bwrap";
    return { name: "kozo sandbox", status: "ok", detail: t("cli.check-confines", { tool }) };
  } catch (error) {
    if (!(error instanceof SandboxUnavailable)) throw error;
    return { name: "kozo sandbox", status: "fail", detail: error.message };
  }
}

/** Whether kozod can list a session's processes, which it does before every session. */
function processesCheck(t: Words): Check {
  return Bun.which("lsof")
    ? { name: "lsof", status: "ok", detail: t("cli.check-lsof-ok") }
    : {
        name: "lsof",
        status: "fail",
        detail: t("cli.check-lsof-missing"),
      };
}

/** The tools Claude Code's sandbox needs on this platform. */
function sandboxCheck(t: Words): Check {
  const tools =
    process.platform === "darwin"
      ? ["sandbox-exec"]
      : process.platform === "linux"
        ? ["bwrap", "socat"]
        : null;
  if (!tools)
    return {
      name: "sandbox",
      status: "fail",
      detail: t("cli.check-no-sandbox", { platform: process.platform }),
    };
  const missing = tools.filter((tool) => !Bun.which(tool));
  return missing.length === 0
    ? { name: "sandbox", status: "ok", detail: tools.join(", ") }
    : {
        name: "sandbox",
        status: "fail",
        detail: t("cli.check-missing-tools", { tools: missing.join(", ") }),
      };
}
