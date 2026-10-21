import { describe, expect, test } from "bun:test";
import { parseFactory } from "./factory.ts";

const example = `version: 1
mode: github
runtime: sdk
repositories:
  - { path: ~/src/app, github: me/app }
  - { path: ~/src/site, github: me/site }
agent_defaults: { model: claude-sonnet-5-5 }
agents:
  review: { model: claude-opus-5-5 }
concurrency: 2
budget: { daily_usd: 15 }
`;

function issuesOf(text: string) {
  const result = parseFactory(text);
  if (result.ok) throw new Error("expected factory.yml to be rejected");
  return result.issues;
}

describe("parseFactory", () => {
  test("parses a github-mode factory", () => {
    const result = parseFactory(example);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.agents?.review?.model).toBe("claude-opus-5-5");
  });

  test("runtime is sdk or cli", () => {
    expect(parseFactory(example.replace("runtime: sdk", "runtime: cli")).ok).toBe(true);
    expect(issuesOf(example.replace("runtime: sdk", "runtime: api"))[0]).toStartWith("runtime:");
  });

  test("a missing field, an unknown field and a wrong version are issues", () => {
    expect(issuesOf(example.replace("concurrency: 2\n", ""))[0]).toStartWith("concurrency:");
    expect(issuesOf(`${example}workers: 3\n`)[0]).toStartWith(
      '<document>: Unrecognized key: "workers"',
    );
    expect(issuesOf(example.replace("version: 1", "version: 2"))[0]).toStartWith("version:");
    expect(issuesOf(example.replace("  review:", "  reviewer:"))[0]).toStartWith("agents:");
  });

  test("github mode needs each repository's GitHub name, and the names must differ", () => {
    expect(issuesOf(example.replace(", github: me/site", ""))).toEqual([
      "repositories.1.github: Name the GitHub repository in github mode",
    ]);
    expect(issuesOf(example.replace("me/site", "other/App"))).toEqual([
      "repositories.1.github: Another repository is also named app",
    ]);
  });

  test("local mode needs no GitHub names", () => {
    const local = example.replace("mode: github", "mode: local").replaceAll(/, github: [^ ]+/g, "");
    expect(parseFactory(local).ok).toBe(true);
  });
});
