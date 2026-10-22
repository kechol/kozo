import { describe, expect, test } from "bun:test";
import { gitRepository } from "@kozo/testing";
import { agentLevel, firstCodeChange, onlyDependencyFiles } from "./risk.ts";

describe("firstCodeChange", () => {
  test("finds code in the diff, a rename into documentation included", async () => {
    await using repo = await gitRepository();
    await repo.commit({ "src/cart.ts": "export const total = 1;\n", "README.md": "# Shop\n" });
    await repo.git("checkout", "--quiet", "-b", "docs");
    await repo.commit({ "README.md": "# Shop\n\nSells things.\n", "docs/notes.rst": "Notes\n" });
    expect(await firstCodeChange(repo.path, "main")).toBeNull();
    await repo.commit({ "requirements.txt": "left-pad==1.0\n" });
    expect(await firstCodeChange(repo.path, "main")).toBe("requirements.txt");

    await repo.git("checkout", "--quiet", "-b", "rename", "main");
    await repo.commit({ "src/cart.ts": null, "docs/cart.md": "export const total = 1;\n" });
    expect(await repo.git("diff", "--name-status", "main...HEAD")).toStartWith("R100");
    expect(await firstCodeChange(repo.path, "main")).toBe("src/cart.ts");
  });

  test("tells a diff of dependency files alone from one that changes code too", async () => {
    await using repo = await gitRepository();
    await repo.commit({ "src/cart.ts": "export const total = 1;\n", "package.json": "{}\n" });
    await repo.git("checkout", "--quiet", "-b", "deps");
    await repo.commit({ "package.json": '{ "dependencies": {} }\n', "bun.lock": "{}\n" });
    expect(await onlyDependencyFiles(repo.path, "main")).toBe(true);
    await repo.commit({ "src/cart.ts": "export const total = 2;\n" });
    expect(await onlyDependencyFiles(repo.path, "main")).toBe(false);
  });
});

test("the agent runs at most the full gates in its sandbox", () => {
  expect([agentLevel("fast"), agentLevel("full"), agentLevel("deep")]).toEqual([
    "fast",
    "full",
    "full",
  ]);
});
