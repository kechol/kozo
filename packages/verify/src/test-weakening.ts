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

// The files that a task runner reads its tasks from when a gate calls it.
const runnerFiles: Record<string, readonly string[]> = {
  make: ["Makefile", "makefile", "GNUmakefile"],
  just: ["justfile", "Justfile", ".justfile"],
  task: ["Taskfile.yml", "Taskfile.yaml", "Taskfile.dist.yml", "Taskfile.dist.yaml"],
  rake: ["Rakefile", "rakefile"],
  tox: ["tox.ini"],
  nox: ["noxfile.py"],
};

const scriptLike = /\.(?:sh|bash|zsh|py|rb|pl|js|mjs|cjs|ts|mts|php|lua)$/;

/**
 * The files whose content decides what a gate command does, mapped to that command: the files
 * it names, such as `scripts/lint.sh`, and the task files its runner reads, such as the
 * Makefile of `make test` or of `make -C sub test`.
 */
export function gateFiles(gateCommands: readonly string[]): Map<string, string> {
  const files = new Map<string, string>();
  for (const command of gateCommands) {
    const words = command
      .split(/[\s;&|()]+/)
      .map((word) => word.replace(/^['"]|['"]$/g, ""))
      .filter(Boolean);
    words.forEach((word, index) => {
      const path = word.replace(/^\.\//, "");
      if (
        !path.startsWith("-") &&
        !path.includes("=") &&
        (path.includes("/") || scriptLike.test(path))
      ) {
        files.set(path, command);
      }
      const names = runnerFiles[word.split("/").at(-1) ?? ""];
      if (!names) return;
      const directory =
        words[index + 1] === "-C" ? `${words[index + 2]?.replace(/\/+$/, "")}/` : "";
      for (const name of names) files.set(`${directory}${name}`, command);
    });
  }
  return files;
}
