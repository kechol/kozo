import { describe, expect, test } from "bun:test";
import { join } from "node:path";

// The developer documents in docs/ describe how kozo is built; these tests fail when what they
// list drifts from the code or from AGENTS.md.
const root = join(import.meta.dir, "..", "..", "..");
const read = (path: string) => Bun.file(join(root, path)).text();

/** The text of the `## heading` section of a Markdown document, up to the next `## `. */
function section(text: string, heading: string): string {
  const start = text.indexOf(`\n## ${heading}\n`);
  if (start < 0) throw new Error(`no "## ${heading}" section`);
  const end = text.indexOf("\n## ", start + 1);
  return text.slice(start, end < 0 ? undefined : end);
}

const squeeze = (text: string) => text.replace(/\s+/g, " ").trim();

/** Each top-level bullet of a section, its wrapped lines joined. */
function bullets(text: string): string[] {
  return text
    .split(/\n- /)
    .slice(1)
    .map((bullet) => squeeze(bullet.split("\n\n")[0] ?? ""));
}

/** The first cell of each body row of the section's table. */
function firstCells(text: string): string[] {
  return text
    .split("\n")
    .filter((line) => line.startsWith("|"))
    .slice(2)
    .map((line) => squeeze(line.split("|")[1] ?? ""));
}

describe("docs/architecture.md", () => {
  test("lists the design invariants AGENTS.md states, each once", async () => {
    const stated = bullets(section(await read("AGENTS.md"), "Design invariants"));
    const listed = firstCells(section(await read("docs/architecture.md"), "Design invariants"));
    expect(stated.length).toBeGreaterThan(0);
    expect(listed).toEqual(stated);
  });
});
