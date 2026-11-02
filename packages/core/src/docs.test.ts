import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { blueprintNodes } from "./blueprint.ts";
import { eventSchema } from "./event.ts";
import { holdTargets, itemEdges, recordOnlyTypes, taskEdges } from "./state.ts";
import { holdKindSchema, runStateSchema, stageSchema } from "./work-model.ts";

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

/** The cells of each body row of the first table after `marker` in the text. */
function rows(text: string, marker = ""): string[][] {
  const lines = text.slice(text.indexOf(marker)).split("\n");
  const start = lines.findIndex((line) => line.startsWith("|"));
  const end = lines.findIndex((line, index) => index > start && !line.startsWith("|"));
  return lines
    .slice(start + 2, end < 0 ? undefined : end)
    .map((line) => line.split("|").slice(1, -1).map(squeeze));
}

/** The first cell of each body row of the section's table. */
const firstCells = (text: string) => rows(text).map(([cell]) => cell ?? "");

const unquote = (cell: string) => cell.replace(/^`|`$/g, "");

describe("docs/architecture.md", () => {
  test("lists the design invariants AGENTS.md states, each once", async () => {
    const stated = bullets(section(await read("AGENTS.md"), "Design invariants"));
    const listed = firstCells(section(await read("docs/architecture.md"), "Design invariants"));
    expect(stated.length).toBeGreaterThan(0);
    expect(listed).toEqual(stated);
  });
});

describe("docs/data-model.md", () => {
  test("lists every event type once, and which change state", async () => {
    const page = section(await read("docs/data-model.md"), "Event lines");
    const listed = rows(page, "### Event types").map(([type, changes]) => [
      unquote(type ?? ""),
      changes,
    ]);
    const types = eventSchema.options.map((option) => option.shape.type.value);
    expect(listed).toEqual(types.map((type) => [type, recordOnlyTypes.has(type) ? "no" : "yes"]));
  });

  test("lists every table of the index once", async () => {
    const page = section(await read("docs/data-model.md"), "The index");
    const schema = await read("packages/daemon/src/index-db.ts");
    const tables = [...schema.matchAll(/^create table (\w+)/gm)].map((match) => match[1] ?? "");
    expect(firstCells(page).map(unquote)).toEqual(tables);
  });
});

describe("docs/lifecycle.md", () => {
  test.each([
    ["Stages", stageSchema.options],
    ["Holds", holdKindSchema.options],
    ["Run states", runStateSchema.options],
  ])("lists every value of %s once", async (heading, values) => {
    const page = section(await read("docs/lifecycle.md"), heading);
    expect(firstCells(page).map(unquote)).toEqual([...values]);
  });

  test.each([
    ["### Item stages", itemEdges],
    ["### Task stages", taskEdges],
  ])("draws the edges of %s with solid arrows", async (marker, edges) => {
    const page = await read("docs/lifecycle.md");
    const block = page.slice(page.indexOf(marker)).split("```mermaid")[1]?.split("```")[0] ?? "";
    const drawn = [...block.matchAll(/^\s*(\w+) --> (\w+)$/gm)].map(
      ([, from, to]) => `${from}>${to}`,
    );
    const coded = Object.entries(edges).flatMap(([from, tos]) =>
      (tos ?? []).map((to) => `${from}>${to}`),
    );
    expect(drawn.sort()).toEqual(coded.sort());
  });

  test("gives each hold its targets", async () => {
    const page = section(await read("docs/lifecycle.md"), "Holds");
    const listed = rows(page).map(([hold, targets]) => [unquote(hold ?? ""), targets]);
    expect(listed).toEqual(
      Object.entries(holdTargets).map(([hold, targets]) => [hold, targets.join(", ")]),
    );
  });

  test("lists the blueprint's nodes in their order", async () => {
    const page = section(await read("docs/lifecycle.md"), "One task's run");
    expect(rows(page, "| Node").map(([node]) => unquote(node ?? ""))).toEqual([...blueprintNodes]);
  });
});

describe("docs/testing.md", () => {
  test("builds its Linux image on the Bun version the repository pins", async () => {
    const pinned = JSON.parse(await read("package.json")).packageManager.replace("bun@", "");
    expect(await read("docs/testing.md")).toContain(`COPY --from=oven/bun:${pinned} `);
  });
});
