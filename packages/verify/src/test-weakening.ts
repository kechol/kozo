import { posix } from "node:path";
import type { ChangedLines } from "./unified-diff.ts";

export type TestWeakening =
  | { kind: "disabled-test"; path: string; line: number; marker: string }
  | { kind: "weakened-test"; path: string; reason: string };

// Each marker turns a test off, focuses the run on other tests, or makes a failure expected.
const markers: [string, RegExp][] = [
  ["skip", /\b(?:describe|it|test|suite|context|bench)(?:\.\w+)*\.skip\b/],
  ["only", /\b(?:describe|it|test|suite|context)(?:\.\w+)*\.only\b/],
  ["todo", /\b(?:describe|it|test)(?:\.\w+)*\.todo\b/],
  ["fixme", /\btest(?:\.\w+)*\.fixme\b/],
  ["expected failure", /\b(?:it|test)(?:\.\w+)*\.(?:fails?|failing)\b/],
  ["conditional run", /\b(?:describe|it|test)(?:\.\w+)*\.(?:skipIf|runIf)\b/],
  ["x or f prefix", /(?<![.\w])(?:xit|xtest|xdescribe|fit|fdescribe)\s*\(/],
  ["skip call", /\b(?:this|ctx|context|t)\.skip\s*\(/],
  ["pytest mark", /@pytest\.mark\.(?:skip|skipif|xfail)\b/],
  ["go skip", /\bt\.Skip(?:Now|f)?\s*\(/],
  ["rust ignore", /#\[ignore\b/],
];

const pattern = (...parts: RegExp[]) => new RegExp(parts.map((part) => part.source).join("|"), "g");

// Lines are matched one at a time, so ^ is the start of a line.
const assertion = pattern(
  /\bexpect(?:\.soft)?\s*\(/,
  /\bexpectTypeOf\s*\(/,
  /\bassert(?:\.\w+)?\s*\(/,
  // pytest and unittest
  /^\s*assert\s+[^(\s]/,
  /\bself\.assert\w+\s*\(/,
  /\bpytest\.raises\s*\(/,
  // Go's testing package and testify
  /\bt\.(?:Error|Errorf|Fatal|Fatalf)\s*\(/,
  /\brequire\.\w+\s*\(/,
  // Rust
  /\b(?:debug_)?assert(?:_eq|_ne)?!\s*\(/,
);
const hasAssertion = new RegExp(assertion.source, "m");
const strictMatcher = pattern(
  /\.(?:toBe|toEqual|toStrictEqual|toMatchObject|toHaveLength|toHaveProperty|toContain|toContainEqual|toThrow|toMatch|toHaveBeenCalledWith|toHaveBeenCalledTimes|toHaveText|toHaveURL|toHaveCount|toHaveValue)\s*\(/,
  /\bassert\.(?:equal|strictEqual|deepEqual|deepStrictEqual|throws|rejects|match)\s*\(/,
  /^\s*assert\s+.*(?:==|!=|<=|>=|<|>|\bnot in\b|\bin\b|\bis\b)/,
  /\bself\.assert(?:Equal|NotEqual|In|NotIn|Is|IsNot|Raises|Regex|CountEqual|DictEqual|ListEqual|AlmostEqual|Greater|Less)\w*\s*\(/,
  /\bpytest\.raises\s*\(/,
  /\b(?:assert|require)\.(?:Equal|EqualValues|Exactly|Contains|Len|ErrorIs|ErrorContains|Panics|Regexp)\w*\s*\(/,
  /\bassert_(?:eq|ne)!\s*\(/,
);
const weakMatcher = pattern(
  /\.(?:toBeTruthy|toBeFalsy|toBeDefined)\s*\(/,
  /\.not\.(?:toThrow|toBeNull|toBeUndefined|toBeNaN)\s*\(/,
  /\bexpect\.(?:anything|any)\s*\(/,
  /\bassert(?:\.ok)?\s*\(/,
  /^\s*assert\s+(?!.*(?:==|!=|<=|>=|<|>|\bin\b|\bis\b))\S/,
  /\bself\.assert(?:True|False|IsNotNone|IsNone)\s*\(/,
  /\b(?:assert|require)\.(?:True|False|NotNil|Nil|NotEmpty|NoError)\s*\(/,
  /\bassert!\s*\(/,
);
const control = /^\s*(?:if\s*\(|try\s*\{|\}?\s*catch\b|\}?\s*else\b)/;
// Returning nothing, or a constant, ends a test before the assertions after it; returning a
// computed value is ordinary helper code and is left to review.
const earlyReturn =
  /^\s*(?:if\s*\(.*\)\s*)?return(?:\s+(?:undefined|null|true|false|void\s+\S+|-?\d+|(["'`]).*\1))?\s*;?\s*$/;

export interface TestFileChange {
  path: string;
  change: "added" | "modified" | "deleted";
  lines: ChangedLines;
}

/**
 * Finds markers that disable tests among the added lines of the test files, and, in test files
 * that existed at the base, assertions that were dropped, loosened or put under a condition.
 * Lines cancel out only where moving them cannot hide anything: within one modified file, and
 * from deleted files into added ones, as in a rename. An added file that receives lines from a
 * deleted one is then checked as if it had existed.
 */
export function findTestWeakening(changes: readonly TestFileChange[]): TestWeakening[] {
  const code = (change: TestFileChange) => ({
    added: change.lines.added.filter(({ text }) => isCode(text)),
    removed: change.lines.removed.filter(isCode),
  });
  const movedOut = changes.filter((c) => c.change === "deleted").flatMap((c) => code(c).removed);
  const movedIn = changes
    .filter((c) => c.change === "added")
    .flatMap((c) => code(c).added.map(({ text }) => text));
  const moveBudget = commonCounts(movedOut, movedIn);
  const deletedBudget = new Map(moveBudget);

  const found: TestWeakening[] = [];
  for (const change of changes) {
    const { path } = change;
    const { added, removed } = code(change);
    let newAdded = added;
    let newRemoved = removed;
    let checked = change.change !== "added";
    let before = removed;
    if (change.change === "modified") {
      const own = commonCounts(
        removed,
        added.map(({ text }) => text),
      );
      const ownRemoved = new Map(own);
      newAdded = added.filter(({ text }) => !take(own, text));
      newRemoved = removed.filter((text) => !take(ownRemoved, text));
    } else if (change.change === "deleted") {
      newRemoved = removed.filter((text) => !take(deletedBudget, text));
    } else {
      newAdded = added.filter(({ text }) => !take(moveBudget, text));
      checked = newAdded.length < added.length;
      before = movedOut;
    }

    for (const { line, text } of newAdded) {
      const hit = markers.find(([, pattern]) => pattern.test(text));
      if (hit) found.push({ kind: "disabled-test", path, line, marker: hit[0] });
    }
    if (!checked) continue;

    const addedTexts = newAdded.map(({ text }) => text);
    const lost = count(newRemoved, assertion);
    const gained = count(addedTexts, assertion);
    if (lost > gained) {
      found.push({
        kind: "weakened-test",
        path,
        reason: `${lost} assertions removed, ${gained} added`,
      });
    }
    if (
      count(newRemoved, strictMatcher) > count(addedTexts, strictMatcher) &&
      count(addedTexts, weakMatcher) > count(newRemoved, weakMatcher)
    ) {
      found.push({ kind: "weakened-test", path, reason: "strict matchers replaced by weak ones" });
    }
    // An assertion that reappears deeper, next to a new branch, was moved under a condition.
    const depths = shallowestAssertions(before);
    const reappeared = added.some(
      ({ text }) => indentation(text) > (depths.get(text.trim()) ?? Number.POSITIVE_INFINITY),
    );
    const newBranches =
      addedTexts.filter((text) => control.test(text)).length >
      newRemoved.filter((text) => control.test(text)).length;
    if (reappeared && newBranches) {
      found.push({ kind: "weakened-test", path, reason: "assertions moved under a condition" });
    }
    if (addedTexts.some((text) => earlyReturn.test(text))) {
      found.push({ kind: "weakened-test", path, reason: "an early return was added" });
    }
  }
  return found;
}

/** The shallowest indentation at which each assertion line stood. */
function shallowestAssertions(texts: readonly string[]) {
  const depths = new Map<string, number>();
  for (const text of texts.filter((line) => hasAssertion.test(line))) {
    const depth = indentation(text);
    depths.set(text.trim(), Math.min(depth, depths.get(text.trim()) ?? depth));
  }
  return depths;
}

function isCode(text: string) {
  return text.trim() !== "" && !isWholeComment(text);
}

function count(texts: readonly string[], pattern: RegExp) {
  return texts.reduce((sum, text) => sum + (text.match(pattern)?.length ?? 0), 0);
}

/** For each trimmed line, how many times it occurs on both sides. */
function commonCounts(left: readonly string[], right: readonly string[]) {
  const tally = (texts: readonly string[]) => {
    const counts = new Map<string, number>();
    for (const text of texts) counts.set(text.trim(), (counts.get(text.trim()) ?? 0) + 1);
    return counts;
  };
  const rightCounts = tally(right);
  const common = new Map<string, number>();
  for (const [text, n] of tally(left)) {
    const both = Math.min(n, rightCounts.get(text) ?? 0);
    if (both > 0) common.set(text, both);
  }
  return common;
}

function take(budget: Map<string, number>, text: string) {
  const remaining = budget.get(text.trim()) ?? 0;
  if (remaining === 0) return false;
  budget.set(text.trim(), remaining - 1);
  return true;
}

function indentation(text: string) {
  return text.length - text.trimStart().length;
}

// Only a line that is a comment as a whole is skipped, and matching always sees the raw line:
// cutting comments out of a line could be fooled by comment markers inside strings. A line that
// closes a block comment before code, such as one ending a doc block, is code. A # comment needs
// a space after it, which JavaScript private fields lack.
function isWholeComment(text: string) {
  const line = text.trim();
  if (line.startsWith("//") || /^#(?:\s|!|$)/.test(line)) return true;
  if (!line.startsWith("/*") && !line.startsWith("*")) return false;
  const close = line.indexOf("*/");
  return close < 0 || close === line.length - 2;
}

/**
 * Names the package.json scripts that the gate commands run, directly or through other scripts,
 * whose definition differs between the two versions, including added pre and post hooks.
 */
export function changedGateScripts(
  gateCommands: readonly string[],
  baseScripts: Record<string, string>,
  headScripts: Record<string, string>,
): string[] {
  const words = (command: string) => command.split(/[^\w:.-]+/).filter(Boolean);
  const reached = new Set<string>();
  const pending = gateCommands.flatMap(words);
  while (pending.length > 0) {
    const word = pending.pop() ?? "";
    if (
      reached.has(word) ||
      !(Object.hasOwn(baseScripts, word) || Object.hasOwn(headScripts, word))
    ) {
      continue;
    }
    reached.add(word);
    for (const body of [baseScripts[word], headScripts[word]]) {
      if (body !== undefined) pending.push(...words(body));
    }
  }
  const names = [...reached].flatMap((name) => [name, `pre${name}`, `post${name}`]);
  return [...new Set(names)].filter((name) => baseScripts[name] !== headScripts[name]).sort();
}

interface Runner {
  /** The task files the runner reads by default. */
  files: readonly string[];
  /** The options that name the directory it runs in. */
  directory: readonly string[];
  /** The options that name a task file instead; each may repeat. */
  file: readonly string[];
}

// Task runners whose task files decide what a gate does, with the options each one takes.
const runners: Record<string, Runner> = {
  make: {
    files: ["Makefile", "makefile", "GNUmakefile"],
    directory: ["-C", "--directory"],
    file: ["-f", "--file", "--makefile"],
  },
  just: {
    files: ["justfile", "Justfile", ".justfile"],
    directory: ["-d", "--working-directory"],
    file: ["-f", "--justfile"],
  },
  task: {
    files: ["Taskfile.yml", "Taskfile.yaml", "Taskfile.dist.yml", "Taskfile.dist.yaml"],
    directory: ["-d", "--dir"],
    file: ["-t", "--taskfile"],
  },
  rake: {
    files: ["Rakefile", "rakefile"],
    directory: ["-C", "--directory"],
    file: ["-f", "--rakefile"],
  },
  tox: { files: ["tox.ini"], directory: [], file: ["-c", "--conf"] },
  nox: { files: ["noxfile.py"], directory: [], file: ["-f", "--noxfile"] },
};

const scriptLike = /\.(?:sh|bash|zsh|py|rb|pl|js|mjs|cjs|ts|mts|php|lua|mk)$/;

const clean = (path: string) =>
  posix.normalize(path.replace(/^['"(]+|['")]+$/g, "")).replace(/\/+$/, "");

/** Every value of an option in `words`: `-C dir`, `-Cdir` or `--directory=dir`. */
function optionValues(words: readonly string[], names: readonly string[]): string[] {
  const values: string[] = [];
  words.forEach((word, index) => {
    for (const name of names) {
      if (word === name && words[index + 1]) values.push(words[index + 1] ?? "");
      else if (name.startsWith("--") && word.startsWith(`${name}=`))
        values.push(word.slice(name.length + 1));
      else if (!name.startsWith("--") && word.startsWith(name) && word.length > name.length) {
        values.push(word.slice(name.length));
      }
    }
  });
  return values;
}

/** A file that decides what a gate does, with the command and the directory the gate runs in. */
export interface GateFile {
  command: string;
  directory: string;
}

/**
 * The files whose content decides what a gate command does: the files it names, such as
 * `scripts/lint.sh`, read from the directory a leading `cd` moves to, and the task files its
 * runner reads, such as the Makefile of `make test`, `make -C sub test` or `make -f ci.mk`, the
 * defaults included whenever a file is named, since a named file may include them.
 */
export function gateFiles(gateCommands: readonly string[]): Map<string, GateFile> {
  const files = new Map<string, GateFile>();
  const at = (base: string, path: string) => clean(posix.join(base, path));
  for (const command of gateCommands) {
    // A cd inside a subshell or a substitution affects only its group, which this split cannot
    // see, so every directory the command moves to counts for every later command in it.
    const directories = new Set(["."]);
    for (const segment of command.split(/&&|\|\||\$\(|[;|&()`]/)) {
      const words = segment.trim().split(/\s+/).filter(Boolean);
      if (words[0] === "cd" && words[1]) {
        for (const directory of [...directories]) directories.add(at(directory, words[1]));
        continue;
      }
      for (const directory of directories) {
        words.forEach((word, index) => {
          const path = clean(word);
          const pathLike = path.includes("/") || scriptLike.test(path);
          if (!path.startsWith("-") && !path.includes("=") && pathLike) {
            files.set(at(directory, path), { command, directory });
          }
          const runner = runners[path.split("/").at(-1) ?? ""];
          if (!runner) return;
          const rest = words.slice(index + 1);
          const runIn = at(directory, optionValues(rest, runner.directory).at(-1) ?? ".");
          for (const name of [...runner.files, ...optionValues(rest, runner.file)]) {
            files.set(at(runIn, name), { command, directory: runIn });
          }
        });
      }
    }
  }
  return files;
}

/** The bodies of the package.json scripts that the gate commands run, directly or through others. */
export function reachedScripts(
  gateCommands: readonly string[],
  scripts: Record<string, string>,
): string[] {
  const words = (command: string) => command.split(/[^\w:.-]+/).filter(Boolean);
  const reached = new Set<string>();
  const pending = gateCommands.flatMap(words);
  while (pending.length > 0) {
    const word = pending.pop() ?? "";
    if (reached.has(word) || !Object.hasOwn(scripts, word)) continue;
    reached.add(word);
    for (const hook of [`pre${word}`, `post${word}`])
      if (Object.hasOwn(scripts, hook)) pending.push(hook);
    pending.push(...words(scripts[word] ?? ""));
  }
  return [...reached].map((name) => scripts[name] ?? "");
}

/**
 * The files that gate files load in turn: a Makefile's include, a shell script's source or
 * dot, followed from `files` as they are at the base, a few levels deep. Each operand is read
 * from the directory the gate runs in and from the including file's own, and a glob is matched
 * against `knownFiles`: the base's files and the diff's, since an added file can match it too.
 */
export async function includedFiles(
  files: Map<string, GateFile>,
  read: (path: string) => Promise<string | null>,
  knownFiles: readonly string[] = [],
): Promise<Map<string, GateFile>> {
  const all = new Map(files);
  let frontier = [...files.keys()];
  for (let depth = 0; depth < 4 && frontier.length > 0; depth += 1) {
    const next: string[] = [];
    for (const path of frontier) {
      const text = await read(path);
      const owner = all.get(path);
      if (text === null || !owner) continue;
      for (const match of text.matchAll(/^\s*(?:-?include|sinclude|source|\.)\s+([^;&|#\n]+)/gm)) {
        for (const operand of (match[1] ?? "").trim().split(/\s+/)) {
          const candidates = [
            posix.join(owner.directory, operand),
            posix.join(posix.dirname(path), operand),
          ].map(clean);
          const expanded = candidates.flatMap((candidate) =>
            /[*?[]/.test(candidate)
              ? knownFiles.filter((file) => new Bun.Glob(candidate).match(file))
              : [candidate],
          );
          for (const included of expanded) {
            if (included === "" || all.has(included)) continue;
            all.set(included, owner);
            next.push(included);
          }
        }
      }
    }
    frontier = next;
  }
  return all;
}
