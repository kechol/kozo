import { describe, expect, test } from "bun:test";
import { parseCharter } from "./charter.ts";

const example = `
version: 1
status: ready
isolation: worktree
protected_paths:
  - "src/auth/**"
  - "**/migrations/**"
  - ".github/**"
  - ".kozo/**"
  - ".claude/**"
  - "AGENTS.md"
existing_tests_protected: true
levels:
  default: L1
  docs: L2
  deps: L2
limits:
  max_changed_lines: 400
  max_files: 8
  max_tasks_per_item: 8
  inner_retries: 2
  ci_fix_rounds: 2
  no_progress_rounds: 3
  max_turns: 40
  max_minutes: 45
  max_cost_usd: 5
backpressure:
  max_awaiting_merge: 3
  max_held: 10
`;

function issuesOf(text: string) {
  const result = parseCharter(text);
  if (result.ok) throw new Error("expected the Charter to be rejected");
  return result.issues;
}

describe("parseCharter", () => {
  test("parses the example Charter", () => {
    const result = parseCharter(example);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.levels).toEqual({ default: "L1", docs: "L2", deps: "L2" });
    expect(result.value.limits.max_cost_usd).toBe(5);
  });

  test("a missing field is an issue at its path", () => {
    expect(issuesOf(example.replace("  max_files: 8\n", ""))).toEqual([
      "limits.max_files: Invalid input: expected number, received undefined",
    ]);
  });

  test("a missing default autonomy level is an issue", () => {
    expect(issuesOf(example.replace("  default: L1\n", ""))[0]).toStartWith("levels.default:");
  });

  test("an unknown key is an issue", () => {
    expect(issuesOf(example.replace("  docs: L2", "  doc: L2"))[0]).toStartWith(
      'levels: Unrecognized key: "doc"',
    );
  });

  test("an unknown version is an issue", () => {
    expect(issuesOf(example.replace("version: 1", "version: 2"))[0]).toStartWith("version:");
  });

  test("a wrong type is an issue", () => {
    expect(issuesOf(example.replace("max_turns: 40", "max_turns: forty"))[0]).toStartWith(
      "limits.max_turns:",
    );
    expect(issuesOf(example.replace("max_files: 8", "max_files: 0"))[0]).toStartWith(
      "limits.max_files:",
    );
    expect(issuesOf(example.replace("deps: L2", "deps: L4"))[0]).toStartWith("levels.deps:");
  });

  test("zero retries are allowed", () => {
    expect(parseCharter(example.replace("inner_retries: 2", "inner_retries: 0")).ok).toBe(true);
  });

  test("a YAML syntax error is an issue on the document", () => {
    expect(issuesOf("version: [1\nstatus: ready")[0]).toStartWith("<document>: ");
  });

  test("an empty file is an issue on the document", () => {
    expect(issuesOf("")[0]).toStartWith("<document>: ");
  });
});
