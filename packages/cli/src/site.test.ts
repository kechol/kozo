import { describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { charterSchema, constraintsSchema, factorySchema } from "@kozo/core";
import { run } from "./index.ts";

// The documentation site describes the CLI and the configuration files; these tests fail when
// either changes without its pages, in English and in Japanese.
const site = join(import.meta.dir, "..", "..", "..", "site");
const docs = join(site, "src", "content", "docs");
const page = (path: string) => Bun.file(join(docs, path)).text();

async function usage(): Promise<string> {
  let text = "";
  await run([], {
    stdout: () => {},
    stderr: (line) => {
      text += `${line}\n`;
    },
    rawStdout: () => {},
    rawStderr: () => {},
  });
  return text;
}

/** The commands the usage lists, such as `up`, `say` and `admin eval run`. */
function commandsOf(text: string): string[] {
  const commands = new Set<string>();
  for (const line of text.split("\n").filter((line) => /^ {2}[a-z]/.test(line))) {
    for (const part of line.trim().split(" | ")) {
      const words: string[] = [];
      for (const word of part.split(/\s+/)) {
        if (!/^[a-z][a-z-]*$/.test(word)) break;
        words.push(word);
      }
      if (words.length > 0) commands.add(words.join(" "));
    }
  }
  return [...commands];
}

/** A zod schema, as far as walking its keys needs. */
interface Schema {
  _zod: { def: unknown };
}

/** Every key a schema's objects name, nested objects and array elements included. */
function keysOf(schema: Schema, keys = new Set<string>()): Set<string> {
  const def = schema._zod.def as {
    type: string;
    shape?: Record<string, Schema>;
    innerType?: Schema;
    element?: Schema;
  };
  if (def.type === "object" && def.shape) {
    for (const [key, value] of Object.entries(def.shape)) {
      keys.add(key);
      keysOf(value, keys);
    }
  } else if (def.innerType) keysOf(def.innerType, keys);
  else if (def.type === "array" && def.element) keysOf(def.element, keys);
  return keys;
}

/** Whether a page names `key` in code: inline, as a dotted path, or as a YAML key. */
function names(text: string, key: string): boolean {
  return (
    new RegExp(`\`[^\`\\n]*\\b${key}\\b[^\`\\n]*\``).test(text) ||
    new RegExp(`^\\s*(- )?${key}:`, "m").test(text)
  );
}

describe("the documentation site", () => {
  test("the CLI page names every command and flag that kozo's usage lists, and no other", async () => {
    const text = await usage();
    const commands = commandsOf(text);
    expect(commands).toContain("admin eval run");
    for (const path of ["cli.md", "ja/cli.md"]) {
      const cli = await page(path);
      const missing = commands.filter((command) => !cli.includes(`kozo ${command}`));
      expect({ path, missing }).toEqual({ path, missing: [] });
      const flags = [...new Set(text.match(/--[a-z][a-z-]*/g))];
      expect({ path, missing: flags.filter((flag) => !cli.includes(flag)) }).toEqual({
        path,
        missing: [],
      });
      const headed = [...cli.matchAll(/^### .*$/gm)].flatMap(([heading]) =>
        [...heading.matchAll(/`kozo ([a-z][a-z -]*?)`/g)].map(([, command]) => command ?? ""),
      );
      // A heading may name a group of commands, such as `kozo admin`.
      const known = (heading: string) =>
        commands.some((command) => command === heading || command.startsWith(`${heading} `));
      expect({ path, unknown: headed.filter((command) => !known(command)) }).toEqual({
        path,
        unknown: [],
      });
    }
  });

  test("each configuration page names every key of its schema", async () => {
    const pages: [string, Schema][] = [
      ["factory-definition.md", factorySchema],
      ["charter.md", charterSchema],
      ["constraints.md", constraintsSchema],
    ];
    for (const [name, schema] of pages) {
      for (const path of [name, `ja/${name}`]) {
        const text = await page(path);
        const missing = [...keysOf(schema)].filter((key) => !names(text, key));
        expect({ path, missing }).toEqual({ path, missing: [] });
      }
    }
  });

  test("every English page has its Japanese page and a place in the sidebar", async () => {
    const pages = (await readdir(docs, { recursive: true }))
      .filter((path) => /\.mdx?$/.test(path))
      .map((path) => relative(docs, join(docs, path)));
    const english = pages.filter((path) => !path.startsWith("ja/")).sort();
    const japanese = pages
      .filter((path) => path.startsWith("ja/"))
      .map((path) => path.slice(3))
      .sort();
    expect(japanese).toEqual(english);
    const config = await Bun.file(join(site, "astro.config.mjs")).text();
    const slugs = english
      .map((path) => path.replace(/\.mdx?$/, ""))
      .filter((slug) => slug !== "index");
    expect(slugs.filter((slug) => !config.includes(`slug: '${slug}'`))).toEqual([]);
  });
});
