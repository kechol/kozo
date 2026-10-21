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

const assertion = /\bexpect(?:\.soft)?\s*\(|\bassert(?:\.\w+)?\s*\(|\bexpectTypeOf\s*\(/g;
const hasAssertion = new RegExp(assertion.source);
const strictMatcher =
  /\.(?:toBe|toEqual|toStrictEqual|toMatchObject|toHaveLength|toHaveProperty|toContain|toContainEqual|toThrow|toMatch|toHaveBeenCalledWith|toHaveBeenCalledTimes|toHaveText|toHaveURL|toHaveCount|toHaveValue)\s*\(|\bassert\.(?:equal|strictEqual|deepEqual|deepStrictEqual|throws|rejects|match)\s*\(/g;
const weakMatcher =
  /\.(?:toBeTruthy|toBeFalsy|toBeDefined)\s*\(|\.not\.toThrow\s*\(|\bexpect\.(?:anything|any)\s*\(|\bassert(?:\.ok)?\s*\(/g;
const control = /^\s*(?:if\s*\(|try\s*\{|\}?\s*catch\b|\}?\s*else\b)/;

export interface TestFileChange {
  path: string;
  lines: ChangedLines;
  /** Whether the file existed at the base, so that it had assertions to lose. */
  existed: boolean;
}

/**
 * Finds markers that disable tests among the added lines of the test files, and, in test files
 * that existed at the base, assertions that were dropped, loosened or put under a condition.
 * Lines that leave one test file and arrive in another, as in a moved or renamed file, cancel
 * out, so that moving a test is not mistaken for removing or adding one.
 */
export function findTestWeakening(changes: readonly TestFileChange[]): TestWeakening[] {
  const removedEverywhere = changes.flatMap(({ lines }) => lines.removed.filter(isCode));
  const addedEverywhere = changes.flatMap(({ lines }) =>
    lines.added.map(({ text }) => text).filter(isCode),
  );
  const shared = commonCounts(removedEverywhere, addedEverywhere);
  const removedBudget = new Map(shared);
  const addedBudget = new Map(shared);
  // The shallowest indentation at which each removed assertion stood.
  const removedAssertions = new Map<string, number>();
  for (const text of removedEverywhere.filter((line) => hasAssertion.test(line))) {
    const depth = indentation(text);
    removedAssertions.set(
      text.trim(),
      Math.min(depth, removedAssertions.get(text.trim()) ?? depth),
    );
  }

  const found: TestWeakening[] = [];
  for (const { path, lines, existed } of changes) {
    const added = lines.added.filter(({ text }) => isCode(text));
    const removed = lines.removed.filter(isCode);
    const newAdded = added.filter(({ text }) => !take(addedBudget, text));
    const newRemoved = removed.filter((text) => !take(removedBudget, text));

    for (const { line, text } of newAdded) {
      const hit = markers.find(([, pattern]) => pattern.test(text));
      if (hit) found.push({ kind: "disabled-test", path, line, marker: hit[0] });
    }
    if (!existed) continue;

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
    const reappeared = added.some(
      ({ text }) => indentation(text) > (removedAssertions.get(text.trim()) ?? Infinity),
    );
    const newBranches =
      addedTexts.filter((text) => control.test(text)).length >
      newRemoved.filter((text) => control.test(text)).length;
    if (reappeared && newBranches) {
      found.push({ kind: "weakened-test", path, reason: "assertions moved under a condition" });
    }
  }
  return found;
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

function isCode(text: string) {
  return text.trim() !== "" && !isComment(text);
}

function isComment(text: string) {
  return /^\s*(?:\/\/|\/\*|\*|#(?!\[))/.test(text);
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
