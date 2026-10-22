import { describe, expect, test } from "bun:test";
import { readlink } from "node:fs/promises";
import { join } from "node:path";
import { parseCharter, parseConstraints, repositoryTemplate } from "@kozo/core";
import { tempDirectory } from "@kozo/testing";
import { installRepositoryTemplate } from "./repository-install.ts";

describe("installRepositoryTemplate", () => {
  test("every document of the template parses, and the Charter waits to be made ready", () => {
    const charter = parseCharter(repositoryTemplate[".kozo/charter.yml"]);
    expect(charter.ok && charter.value.status).toBe("incomplete");
    expect(parseConstraints(repositoryTemplate[".kozo/constraints.yml"]).ok).toBe(true);
  });

  test("adds what is missing, keeps what exists, and a second run adds nothing", async () => {
    await using dir = await tempDirectory({ "AGENTS.md": "# Ours\n" });
    expect(await installRepositoryTemplate(dir.path, "local")).toEqual([
      ".kozo/charter.yml",
      ".kozo/constraints.yml",
      ".kozo/verify-app.md",
      "CLAUDE.md",
    ]);
    expect(await Bun.file(join(dir.path, "AGENTS.md")).text()).toBe("# Ours\n");
    expect(await readlink(join(dir.path, "CLAUDE.md"))).toBe("AGENTS.md");
    expect(await installRepositoryTemplate(dir.path, "local")).toEqual([]);
    expect(await installRepositoryTemplate(dir.path, "github")).toEqual([
      ".github/workflows/kozo.yml",
    ]);
  });
});
