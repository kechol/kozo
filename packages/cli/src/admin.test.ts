import { describe, expect, test } from "bun:test";
import { readlink } from "node:fs/promises";
import { join } from "node:path";
import { tempDirectory } from "@kozo/testing";
import { run } from "./index.ts";

describe("kozo admin install", () => {
  test("in local mode writes the missing files into the working tree, once", async () => {
    await using home = await tempDirectory();
    await using repo = await tempDirectory({ "AGENTS.md": "# Ours\n" });
    const saved = process.env.KOZO_HOME;
    process.env.KOZO_HOME = home.path;
    try {
      const lines: string[] = [];
      const out = {
        stdout: (line: string) => lines.push(line),
        stderr: () => {},
        rawStdout: () => {},
        rawStderr: () => {},
      };
      expect(await run(["admin", "install", repo.path, "--json"], out)).toBe(0);
      expect(JSON.parse(lines[0] ?? "{}").written).toEqual([
        ".kozo/charter.yml",
        ".kozo/constraints.yml",
        ".kozo/verify-app.md",
        "CLAUDE.md",
      ]);
      expect(await readlink(join(repo.path, "CLAUDE.md"))).toBe("AGENTS.md");
      expect(await Bun.file(join(repo.path, ".github", "workflows", "kozo.yml")).exists()).toBe(
        false,
      );
      expect(await run(["admin", "install", repo.path], out)).toBe(0);
      expect(lines.at(-1)).toBe(`${repo.path} has every file kozo installs`);
    } finally {
      if (saved === undefined) delete process.env.KOZO_HOME;
      else process.env.KOZO_HOME = saved;
    }
  });
});
