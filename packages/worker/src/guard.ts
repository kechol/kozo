import { lstatSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { globMatcher, protectedPathMatcher } from "@kozo/verify";
import type { GuardDecision } from "./coding-agent.ts";
import { parseShell, ShellParseError, type Word } from "./shell.ts";

/** What one task's agent may touch, decided before its run starts. */
export interface TaskPolicy {
  /** The worktree, the only directory the file tools may reach. */
  worktree: string;
  /** Path globs outside which the file tools may not write. */
  scope: readonly string[];
  /** The Charter's protected paths. */
  protectedPaths: readonly string[];
  /** Test files that exist at the base, when the Charter protects existing tests. */
  existingTests: ReadonlySet<string>;
}

const allow: GuardDecision = { allow: true };
const refuse = (reason: string): GuardDecision => ({ allow: false, reason });

/** The real path of `path`, resolving symbolic links through its nearest existing ancestor. */
function realPath(path: string): string {
  let existing = path;
  const rest: string[] = [];
  for (;;) {
    try {
      return resolve(realpathSync(existing), ...rest.reverse());
    } catch {
      const parent = dirname(existing);
      if (parent === existing) return path;
      rest.push(basename(existing));
      existing = parent;
    }
  }
}

/** The path relative to the worktree, or null when it lies outside it or inside `.git`. */
function insideWorktree(policy: TaskPolicy, path: string): string | null {
  const root = realPath(policy.worktree);
  const target = realPath(isAbsolute(path) ? path : resolve(policy.worktree, path));
  const rel = relative(root, target);
  if (rel === "") return ".";
  if (rel.startsWith("..") || isAbsolute(rel)) return null;
  if (rel.split(sep).includes(".git")) return null;
  return rel.split(sep).join("/");
}

/**
 * Why the file tools, which run outside the sandbox, must not follow this path as given: a
 * symbolic link on the way, which the shell could re-point after the check, or a file with
 * several hard links, which may be one outside the worktree.
 */
function linkProblem(policy: TaskPolicy, path: string): string | null {
  const absolute = isAbsolute(path) ? path : resolve(policy.worktree, path);
  // The worktree itself may sit below a symbolic link, such as /var on macOS; only what lies
  // below it is the agent's to have made.
  const root = [policy.worktree, realPath(policy.worktree)].find(
    (candidate) => !relative(candidate, absolute).startsWith(".."),
  );
  if (root === undefined) return null;
  let current = root;
  for (const part of relative(root, absolute).split(sep).filter(Boolean)) {
    current = resolve(current, part);
    let stats: ReturnType<typeof lstatSync>;
    try {
      stats = lstatSync(current);
    } catch {
      return null;
    }
    if (stats.isSymbolicLink()) return `${path} goes through a symbolic link`;
    if (stats.isFile() && stats.nlink > 1) return `${path} has more than one hard link`;
  }
  return null;
}

function checkRead(policy: TaskPolicy, path: unknown): GuardDecision {
  if (path === undefined) return allow;
  if (typeof path !== "string") return refuse("the path is not text");
  if (insideWorktree(policy, path) === null) return refuse(`${path} is outside the worktree`);
  const problem = linkProblem(policy, path);
  return problem ? refuse(problem) : allow;
}

function checkWrite(policy: TaskPolicy, path: unknown): GuardDecision {
  if (typeof path !== "string") return refuse("the path is not text");
  const rel = insideWorktree(policy, path);
  if (rel === null) return refuse(`${path} is outside the worktree`);
  const problem = linkProblem(policy, path);
  if (problem) return refuse(problem);
  if (policy.protectedPaths.some((pattern) => protectedPathMatcher(pattern)(rel))) {
    return refuse(`${rel} is a protected path; ask with kozo_blocked if it must change`);
  }
  if (!globMatcher(policy.scope)(rel)) {
    return refuse(`${rel} is outside the task's scope (${policy.scope.join(", ")})`);
  }
  if (policy.existingTests.has(rel)) {
    return refuse(`${rel} is an existing test, which this repository does not let a task change`);
  }
  return allow;
}

// Commands that act outside the worktree in ways the sandbox cannot see, or hand out access.
const refusedCommands = new Map([
  ["gh", "the factory alone talks to GitHub"],
  ["hub", "the factory alone talks to GitHub"],
  ["glab", "the factory alone talks to a forge"],
  ["sudo", "commands run as the worker's own user"],
  ["su", "commands run as the worker's own user"],
  ["doas", "commands run as the worker's own user"],
  ["alias", "aliases would hide what a later command runs"],
  ["nohup", "nothing may keep running after its command"],
  ["setsid", "nothing may keep running after its command"],
  ["disown", "nothing may keep running after its command"],
  ["crontab", "nothing may be scheduled outside the run"],
  ["at", "nothing may be scheduled outside the run"],
  ["launchctl", "nothing may be started outside the run"],
  ["systemctl", "nothing may be started outside the run"],
  ["osascript", "it runs outside the sandbox"],
  ["open", "it runs outside the sandbox"],
  ["docker", "it runs outside the sandbox"],
  ["podman", "it runs outside the sandbox"],
  ["ssh", "the run has no network beyond this machine"],
  ["scp", "the run has no network beyond this machine"],
]);

const shells = new Set(["sh", "bash", "zsh", "dash", "ksh"]);

// git subcommands that only read, or only change the worktree, the index and the task branch.
const gitAllowed = new Set([
  "add",
  "am",
  "apply",
  "bisect",
  "blame",
  "cat-file",
  "check-attr",
  "check-ignore",
  "cherry-pick",
  "clean",
  "commit",
  "commit-tree",
  "count-objects",
  "describe",
  "diff",
  "diff-files",
  "diff-index",
  "diff-tree",
  "format-patch",
  "fsck",
  "grep",
  "hash-object",
  "log",
  "ls-files",
  "ls-tree",
  "merge-base",
  "merge-file",
  "mktree",
  "mv",
  "name-rev",
  "range-diff",
  "read-tree",
  "reset",
  "restore",
  "rev-list",
  "rev-parse",
  "revert",
  "rm",
  "shortlog",
  "show",
  "show-branch",
  "show-ref",
  "stash",
  "status",
  "var",
  "version",
  "whatchanged",
  "write-tree",
]);

/** Whether every argument is one of `flags`, with `=value` allowed where a flag ends in `=`. */
const onlyFlags = (args: readonly string[], flags: readonly string[]) =>
  args.every((arg) =>
    flags.some((flag) => (flag.endsWith("=") ? arg.startsWith(flag) : arg === flag)),
  );
const positionals = (args: readonly string[]) => args.filter((arg) => !arg.startsWith("-"));

// git accepts any unambiguous prefix of a long option, so these allow listed spellings only.
const gitListing: Record<string, (args: string[]) => boolean> = {
  branch: (args) =>
    onlyFlags(args, [
      "-a",
      "-r",
      "-l",
      "--list",
      "-v",
      "-vv",
      "--show-current",
      "--no-color",
      "--color",
      "--color=",
      "--format=",
      "--sort=",
    ]),
  tag: (args) =>
    args.length === 0 ||
    ((args[0] === "-l" || args[0] === "--list") &&
      positionals(args.slice(1)).length === args.length - 1),
  remote: (args) =>
    args.length === 0 ||
    (args.length === 1 && args[0] === "-v") ||
    (args[0] === "get-url" && positionals(args).length === args.length),
  config: (args) => {
    const flags = args.filter((arg) => arg.startsWith("-"));
    const reading = ["--get", "--get-all", "--get-regexp", "--list", "-l"];
    const read =
      flags.some((flag) => reading.includes(flag)) || args[0] === "get" || args[0] === "list";
    return (
      read &&
      onlyFlags(flags, [
        ...reading,
        "--show-origin",
        "--show-scope",
        "--local",
        "--global",
        "--null",
        "-z",
        "--name-only",
        "--type=",
        "--default=",
      ])
    );
  },
  checkout: (args) => {
    const split = args.indexOf("--");
    if (split === -1) return false;
    const before = args.slice(0, split);
    return (
      positionals(before).length <= 1 &&
      onlyFlags(
        before.filter((arg) => arg.startsWith("-")),
        ["-q", "--quiet"],
      )
    );
  },
  rebase: (args) => {
    const rest = [...args];
    const onto = rest.indexOf("--onto");
    if (onto !== -1) rest.splice(onto, 2);
    const flags = rest.filter((arg) => arg.startsWith("-"));
    return (
      positionals(rest).length <= 1 &&
      onlyFlags(flags, [
        "--continue",
        "--abort",
        "--skip",
        "--quit",
        "-q",
        "--quiet",
        "--autostash",
        "--no-autostash",
        "--keep-base",
      ])
    );
  },
  reflog: (args) =>
    args.length === 0 || (args[0] === "show" && positionals(args).length === args.length),
  notes: (args) =>
    args.length === 0 ||
    ((args[0] === "list" || args[0] === "show") && positionals(args).length === args.length),
  worktree: (args) => args[0] === "list" && onlyFlags(args.slice(1), ["--porcelain"]),
};

const gitRefusedReasons: Record<string, string> = {
  push: "only kozod pushes",
  pull: "the task branch starts from the default branch kozod chose",
  fetch: "the run has no network beyond this machine",
  merge: "humans merge",
  "update-ref": "the run may change only its task branch",
  "symbolic-ref": "the run may change only its task branch",
  switch: "the run stays on its task branch",
  "filter-branch": "history outside the task branch is not the run's",
  replace: "the run may change only its task branch",
  submodule: "submodules change what the repository checks out",
};

interface Analysis {
  policy: TaskPolicy;
  heredocs: string[];
  depth: number;
  /** Scripts in the worktree that the command may run, read before the analysis. */
  scripts: ReadonlyMap<string, string | null>;
  /**
   * Whether the command is the only one in its call. A script is read before the call runs,
   * so it may only run where nothing earlier in the same call could have rewritten it.
   */
  alone: boolean;
}

function analyzeGit(args: Word[], context: Analysis): GuardDecision {
  const words = [...args];
  while (words.length > 0 && words[0]?.text.startsWith("-")) {
    const option = words.shift()?.text ?? "";
    if (option === "-c" || option.startsWith("--config-env")) {
      return refuse("git -c and --config-env would change git's configuration for the command");
    }
    if (/^--(git-dir|work-tree|namespace|exec-path|super-prefix|bare)/.test(option)) {
      return refuse(`git ${option} would point git somewhere other than the worktree`);
    }
    if (option === "-C") {
      const path = words.shift();
      if (!path || path.dynamic || insideWorktree(context.policy, path.text) === null) {
        return refuse("git -C must name a directory inside the worktree");
      }
    }
  }
  const subcommand = words.shift();
  if (!subcommand) return allow;
  if (subcommand.dynamic) return refuse("a git subcommand built from an expansion");
  const name = subcommand.text;
  const rest = words.map((word) => word.text);
  const reason = gitRefusedReasons[name];
  if (reason) return refuse(`git ${name}: ${reason}`);
  if (name === "bisect" && rest[0] === "run") return analyzeCommand(words.slice(1), context);
  if (name === "grep" && rest.some((arg) => arg.startsWith("-O") || arg.startsWith("--op"))) {
    return refuse("git grep --open-files-in-pager runs another program");
  }
  if (gitAllowed.has(name)) return allow;
  const listing = gitListing[name];
  if (listing?.(rest)) return allow;
  if (listing) return refuse(`git ${name} ${rest.join(" ")} would change a ref or a setting`);
  return refuse(`git ${name} is not a command a run may use`);
}

function analyzeScript(text: string, context: Analysis): GuardDecision {
  if (context.depth > 8) return refuse("the command nests too deeply to check");
  let parsed: ReturnType<typeof parseShell>;
  try {
    parsed = parseShell(text);
  } catch (error) {
    if (error instanceof ShellParseError)
      return refuse(`the command does not parse: ${error.message}`);
    throw error;
  }
  if (parsed.background) return refuse("background jobs could change files after this check");
  const inner: Analysis = {
    ...context,
    heredocs: [...context.heredocs, ...parsed.heredocs],
    depth: context.depth + 1,
    alone: context.alone && parsed.commands.length === 1 && parsed.heredocs.length === 0,
  };
  for (const words of parsed.commands) {
    const decision = analyzeCommand(words, inner);
    if (!decision.allow) return decision;
  }
  return allow;
}

async function readScript(context: Analysis, path: string): Promise<string | null> {
  const rel = insideWorktree(context.policy, path);
  if (rel === null) return null;
  const file = Bun.file(resolve(context.policy.worktree, rel));
  return (await file.exists()) ? await file.text() : null;
}

function analyzeCommand(input: Word[], context: Analysis): GuardDecision {
  const words = [...input];
  while (words.length > 0 && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0]?.text ?? "")) {
    const assignment = words.shift()?.text ?? "";
    if (assignment.startsWith("GIT_"))
      return refuse(`${assignment.split("=")[0]} would redirect git`);
  }
  const first = words[0];
  if (!first) return allow;
  if (first.dynamic) return refuse("a command name built from an expansion");
  const name = basename(first.text);
  const args = words.slice(1);
  const refused = refusedCommands.get(name);
  if (refused) return refuse(`${name}: ${refused}`);

  if (name === "export" || name === "declare" || name === "typeset" || name === "local") {
    const git = args.find((arg) => arg.text.startsWith("GIT_"));
    if (git) return refuse(`${git.text.split("=")[0]} would redirect git`);
    return allow;
  }
  if (name === "git") return analyzeGit(args, context);
  if (["command", "builtin", "exec", "time", "caffeinate"].includes(name)) {
    const offset = args.findIndex((arg) => !arg.text.startsWith("-"));
    return offset === -1 ? allow : analyzeCommand(args.slice(offset), context);
  }
  if (name === "env") {
    const rest = [...args];
    while (rest.length > 0) {
      const text = rest[0]?.text ?? "";
      if (text === "-S" || text === "--split-string") {
        const script = rest[1];
        if (!script || script.dynamic)
          return refuse("env -S with a string built from an expansion");
        return analyzeScript(script.text, context);
      }
      if (text === "-u" || text === "--unset" || text === "-C" || text === "--chdir")
        rest.splice(0, 2);
      else if (text.startsWith("-") || /^[A-Za-z_][A-Za-z0-9_]*=/.test(text)) {
        if (text.startsWith("GIT_")) return refuse(`${text.split("=")[0]} would redirect git`);
        rest.shift();
      } else break;
    }
    return analyzeCommand(rest, context);
  }
  if (name === "nice" || name === "timeout" || name === "stdbuf" || name === "xargs") {
    const rest = [...args];
    while (
      rest.length > 0 &&
      (rest[0]?.text.startsWith("-") || (name === "timeout" && /^\d/.test(rest[0]?.text ?? "")))
    ) {
      const option = rest.shift()?.text ?? "";
      if (/^-(n|s|k|I|L|P|d|E)$/.test(option)) rest.shift();
    }
    if (name === "timeout" && /^\d/.test(rest[0]?.text ?? "")) rest.shift();
    return analyzeCommand(rest, context);
  }
  if (name === "eval") {
    if (args.some((arg) => arg.dynamic)) return refuse("eval of text built from an expansion");
    return analyzeScript(args.map((arg) => arg.text).join(" "), context);
  }
  if (name === "source" || name === ".") {
    const path = args[0];
    if (!path || path.dynamic) return refuse(`${name} of a path built from an expansion`);
    const script = context.scripts.get(path.text) ?? null;
    if (script === null)
      return refuse(`${name} ${path.text}: only scripts inside the worktree may run`);
    if (!context.alone) return refuse(`run ${path.text} in a Bash call of its own`);
    return analyzeScript(script, context);
  }
  if (shells.has(name)) {
    const command = args.findIndex((arg) => /^-[a-z]*c[a-z]*$/.test(arg.text));
    if (command !== -1) {
      const script = args[command + 1];
      if (!script || script.dynamic)
        return refuse(`${name} -c with a script built from an expansion`);
      return analyzeScript(script.text, context);
    }
    const file = args.find((arg) => !arg.text.startsWith("-"));
    if (file) {
      if (file.dynamic) return refuse(`${name} with a script path built from an expansion`);
      const script = context.scripts.get(file.text) ?? null;
      if (script === null)
        return refuse(`${name} ${file.text}: only scripts inside the worktree may run`);
      if (!context.alone) return refuse(`run ${file.text} in a Bash call of its own`);
      return analyzeScript(script, context);
    }
    if (context.heredocs.length === 0) return refuse(`${name} reading its script from a pipe`);
    for (const heredoc of context.heredocs) {
      const decision = analyzeScript(heredoc, { ...context, heredocs: [] });
      if (!decision.allow) return decision;
    }
    return allow;
  }
  if (name === "find") {
    for (let index = 0; index < args.length; index += 1) {
      if (!/^-(exec|execdir|ok|okdir)$/.test(args[index]?.text ?? "")) continue;
      const end = args.findIndex((arg, at) => at > index && (arg.text === ";" || arg.text === "+"));
      const decision = analyzeCommand(args.slice(index + 1, end === -1 ? undefined : end), context);
      if (!decision.allow) return decision;
    }
    return allow;
  }
  if (first.text.includes("/") && !isAbsolute(first.text)) {
    // A script in the worktree run by its path is checked like any other shell script; one
    // without a #! line runs as sh too.
    const script = context.scripts.get(first.text) ?? null;
    const interpreter = script?.startsWith("#!") ? (script.split("\n")[0] ?? "") : "#!/bin/sh";
    if (script !== null && /\b(sh|bash|zsh|dash|ksh)\b/.test(interpreter)) {
      if (!context.alone) return refuse(`run ${first.text} in a Bash call of its own`);
      return analyzeScript(script, context);
    }
  }
  return allow;
}

/** Collects the scripts a command may run, so that the synchronous analysis can read them. */
async function scriptsOf(
  command: string,
  policy: TaskPolicy,
  seen = new Map<string, string | null>(),
) {
  let parsed: ReturnType<typeof parseShell>;
  try {
    parsed = parseShell(command);
  } catch {
    return seen;
  }
  const context: Analysis = {
    policy,
    heredocs: parsed.heredocs,
    depth: 0,
    scripts: seen,
    alone: true,
  };
  const candidates = parsed.commands.flatMap((words) =>
    words.filter((word) => !word.dynamic && !word.text.startsWith("-")).map((word) => word.text),
  );
  for (const candidate of candidates) {
    if (seen.has(candidate) || seen.size > 32) continue;
    const script = await readScript(context, candidate);
    seen.set(candidate, script);
    if (script !== null) await scriptsOf(script, policy, seen);
  }
  return seen;
}

/**
 * Decides one tool call for a task's agent. The file tools must stay inside the worktree and
 * out of `.git`, and writes inside the scope and off protected paths and existing tests. A
 * shell command is split into every simple command it would run, through `bash -c`, `eval`,
 * substitutions and scripts in the worktree, and refused when any of them pushes, merges,
 * moves a ref other than the task branch, reaches GitHub, or cannot be checked at all.
 */
export async function guardToolCall(
  tool: string,
  input: unknown,
  policy: TaskPolicy,
): Promise<GuardDecision> {
  const fields = (typeof input === "object" && input !== null ? input : {}) as Record<
    string,
    unknown
  >;
  switch (tool) {
    case "Read":
      return checkRead(policy, fields.file_path);
    case "Glob":
    case "Grep": {
      const pattern = tool === "Glob" ? fields.pattern : fields.glob;
      if (
        typeof pattern === "string" &&
        (isAbsolute(pattern) || pattern.split("/").includes(".."))
      ) {
        return refuse("the pattern reaches outside the worktree");
      }
      return checkRead(policy, fields.path);
    }
    case "Edit":
    case "Write":
      return checkWrite(policy, fields.file_path);
    case "Bash": {
      if (typeof fields.command !== "string") return refuse("the command is not text");
      const scripts = await scriptsOf(fields.command, policy);
      return analyzeScript(fields.command, {
        policy,
        heredocs: [],
        depth: 0,
        scripts,
        alone: true,
      });
    }
    default:
      return tool.startsWith("mcp__kozo__") ? allow : refuse(`${tool} is not a tool a run may use`);
  }
}
