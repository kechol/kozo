import { lstatSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { globMatcher, isNewTestCase, protectedPathMatcher } from "@kozo/verify";
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
  /** The constraints' test globs: a new test case may be written outside the scope. */
  tests?: readonly string[];
  /** Every file at the base, to tell a new test case from an existing file. */
  baseFiles?: ReadonlySet<string>;
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
  // A test case that did not exist at the base may go outside the scope; its "new" comes from
  // the base, so an agent may also edit the test it wrote itself.
  const newTest =
    policy.tests !== undefined &&
    policy.baseFiles !== undefined &&
    !policy.baseFiles.has(rel) &&
    isNewTestCase(rel, policy.tests);
  if (!globMatcher(policy.scope)(rel) && !newTest) {
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
  ["kozo", "the gates run through the kozo_gates tool"],
]);

const shells = new Set(["sh", "bash", "zsh", "dash", "ksh"]);

// Commands whose arguments the guard reads to decide, so xargs may not add any to them.
const argumentsRead = new Set([
  ...shells,
  "git",
  "eval",
  "source",
  ".",
  "find",
  "export",
  "declare",
  "typeset",
  "local",
  "command",
  "builtin",
  "exec",
  "time",
  "caffeinate",
  "env",
  "nice",
  "timeout",
  "stdbuf",
  "xargs",
]);

// git subcommands that only read, or only change the worktree, the index and the task branch.
const gitAllowed = new Set([
  "add",
  "am",
  "apply",
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
    // A commit with no path after -- would switch the worktree to it.
    const commit = positionals(before).length;
    return (
      (commit === 0 || (commit === 1 && split < args.length - 1)) &&
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
  bisect: "it moves HEAD off the task branch",
};

// The options of each command that runs another, and whether each takes a value, as the next
// word or attached (`-n1`, `--max-args=1`). An option missing here could take the command's
// place as its value, so the guard refuses it. Missing on purpose: `env -S`, since env splits
// its string by escapes and expansions of its own, and `xargs -I`, since its replacement can
// stand for any word, the command name included.
const wrapperOptions: Record<string, Record<string, boolean>> = {
  command: { "-p": false, "-v": false, "-V": false },
  builtin: {},
  exec: { "-c": false, "-l": false, "-a": true },
  time: { "-p": false },
  caffeinate: { "-d": false, "-i": false, "-m": false, "-s": false, "-u": false, "-t": true },
  env: {
    "-i": false,
    "--ignore-environment": false,
    "-0": false,
    "--null": false,
    "-v": false,
    "--debug": false,
    "-u": true,
    "--unset": true,
    "-C": true,
    "--chdir": true,
    "-P": true,
  },
  nice: { "-n": true, "--adjustment": true },
  timeout: {
    "-s": true,
    "--signal": true,
    "-k": true,
    "--kill-after": true,
    "-v": false,
    "--verbose": false,
    "--preserve-status": false,
    "--foreground": false,
  },
  stdbuf: {
    "-i": true,
    "-o": true,
    "-e": true,
    "--input": true,
    "--output": true,
    "--error": true,
  },
  xargs: {
    "-0": false,
    "--null": false,
    "-r": false,
    "--no-run-if-empty": false,
    "-t": false,
    "--verbose": false,
    "-x": false,
    "--exit": false,
    "-n": true,
    "--max-args": true,
    "-L": true,
    "--max-lines": true,
    "-P": true,
    "--max-procs": true,
    "-s": true,
    "--max-chars": true,
    "-d": true,
    "--delimiter": true,
    "-E": true,
    "-a": true,
    "--arg-file": true,
  },
};

/**
 * The command a wrapper runs, after its options, refusing an option the wrapper does not list
 * or one built from an expansion.
 */
function wrapped(name: string, args: readonly Word[]): { command: Word[] } | { refused: string } {
  const options = wrapperOptions[name] ?? {};
  let index = 0;
  while (index < args.length) {
    const word = args[index] as Word;
    if (word.dynamic) return { refused: `${name} with an argument built from an expansion` };
    const text = word.text;
    if (text === "--") {
      index += 1;
      break;
    }
    if (!text.startsWith("-") || text === "-") break;
    if (name === "nice" && /^-\d+$/.test(text)) {
      index += 1;
      continue;
    }
    const long = text.startsWith("--");
    const flag = long ? (text.split("=")[0] ?? text) : text.slice(0, 2);
    const takes = options[flag];
    const attached = long ? text.includes("=") : text.length > 2;
    if (takes === undefined || (takes === false && attached)) {
      return { refused: `${name} ${text}: an option the guard does not know` };
    }
    if (takes === false) {
      index += 1;
      continue;
    }
    const value = attached
      ? { text: long ? text.slice(flag.length + 1) : text.slice(2), dynamic: false }
      : args[index + 1];
    if (!value) return { refused: `${name} ${flag} without its value` };
    if (value.dynamic) return { refused: `${name} ${flag} with a value built from an expansion` };
    index += attached ? 1 : 2;
  }
  return { command: args.slice(index) };
}

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

/** git grep -O in any spelling: in a group of short flags, or as a prefix of the long option. */
function opensPager(arg: string): boolean {
  if (/^-[^-]/.test(arg)) return arg.slice(1).includes("O");
  const name = arg.split("=")[0] ?? "";
  return name.length > 3 && "--open-files-in-pager".startsWith(name);
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
      if (
        !path ||
        path.dynamic ||
        path.text.includes("{}") ||
        insideWorktree(context.policy, path.text) === null
      ) {
        return refuse("git -C must name a directory inside the worktree");
      }
    }
  }
  const subcommand = words.shift();
  if (!subcommand) return allow;
  if (subcommand.dynamic) return refuse("a git subcommand built from an expansion");
  const name = subcommand.text;
  // A path built from an expansion may be empty, which would leave `checkout <commit> --` alone.
  const rest = words
    .filter((word) => name !== "checkout" || !word.dynamic)
    .map((word) => word.text);
  // An argument built from an expansion could turn into any option. Only paths after a literal
  // --, and the message of git commit or git stash, as in commit -m "$(cat <<EOF ...)", may be.
  const paths = words.findIndex((word) => !word.dynamic && word.text === "--");
  const takesMessage = name === "commit" || name === "stash";
  const dynamicOption = words.findIndex((word, index) => {
    if (!word.dynamic || (paths !== -1 && index > paths)) return false;
    const flag = words[index - 1];
    return !(takesMessage && flag && !flag.dynamic && /^(-m|--message|-F|--file)$/.test(flag.text));
  });
  if (dynamicOption !== -1) return refuse(`git ${name}: an argument built from an expansion`);
  const reason = gitRefusedReasons[name];
  if (reason) return refuse(`git ${name}: ${reason}`);
  if (name === "grep" && rest.some(opensPager)) {
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

async function readScript(policy: TaskPolicy, path: string): Promise<string | null> {
  const rel = insideWorktree(policy, path);
  if (rel === null) return null;
  const file = Bun.file(resolve(policy.worktree, rel));
  return (await file.exists()) ? await file.text() : null;
}

/**
 * A script in the worktree that `how` runs: it must have been read beforehand, and it must be
 * the whole Bash call, so that nothing in the same call can change it between check and run.
 */
function runScript(how: string, path: string, context: Analysis): GuardDecision {
  const script = context.scripts.get(path) ?? null;
  if (script === null) return refuse(`${how} ${path}: only scripts inside the worktree may run`);
  if (!context.alone) return refuse(`run ${path} in a Bash call of its own`);
  return analyzeScript(script, context);
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
  // find -exec and xargs put found paths in place of {}, so the name could be any program.
  if (first.text.includes("{}")) return refuse("a command name that find or xargs fills in");
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
  if (name in wrapperOptions) {
    const parsed = wrapped(name, args);
    if ("refused" in parsed) return refuse(parsed.refused);
    const rest = [...parsed.command];
    if (name === "timeout") rest.shift();
    while (name === "env" && /^[A-Za-z_][A-Za-z0-9_]*=/.test(rest[0]?.text ?? "")) {
      const assignment = rest.shift()?.text ?? "";
      if (assignment.startsWith("GIT_"))
        return refuse(`${assignment.split("=")[0]} would redirect git`);
    }
    const target = basename(rest[0]?.text ?? "");
    if (name === "xargs" && argumentsRead.has(target))
      return refuse(
        `xargs ${target}: xargs adds arguments from its input that the guard never reads`,
      );
    return analyzeCommand(rest, context);
  }
  if (name === "eval") {
    if (args.some((arg) => arg.dynamic)) return refuse("eval of text built from an expansion");
    return analyzeScript(args.map((arg) => arg.text).join(" "), context);
  }
  if (name === "source" || name === ".") {
    const path = args[0];
    if (!path || path.dynamic) return refuse(`${name} of a path built from an expansion`);
    return runScript(name, path.text, context);
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
      return runScript(name, file.text, context);
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
    const shell = interpreter.split(/[\s/]+/).some((part) => shells.has(part));
    if (script !== null && shell) return runScript("run", first.text, context);
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
  const candidates = parsed.commands.flatMap((words) =>
    words.filter((word) => !word.dynamic && !word.text.startsWith("-")).map((word) => word.text),
  );
  for (const candidate of candidates) {
    if (seen.has(candidate) || seen.size > 32) continue;
    const script = await readScript(policy, candidate);
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
    // The SDK's own tool by which a session hands in its structured answer.
    case "StructuredOutput":
      return allow;
    default:
      return tool.startsWith("mcp__kozo__") ? allow : refuse(`${tool} is not a tool a run may use`);
  }
}
