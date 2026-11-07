import { describe, expect, test } from "bun:test";
import { tempDirectory } from "@kozo/testing";
import { GitError, git } from "./git.ts";

describe("git", () => {
  test("kills git that runs out of time and does not wait for what it started", async () => {
    await using dir = await tempDirectory();
    const started = performance.now();
    // The alias's sleep outlives git and holds its output open.
    const call = git(dir.path, ["-c", "alias.wait=!sleep 23", "wait"], { timeoutMs: 300 });
    await expect(call).rejects.toThrow(GitError);
    await expect(call).rejects.toThrow("ran out of time after 300 ms");
    expect(performance.now() - started).toBeLessThan(5_000);
  });

  test("returns stdout within its time", async () => {
    await using dir = await tempDirectory();
    expect((await git(dir.path, ["--version"], { timeoutMs: 10_000 })).trim()).toStartWith(
      "git version",
    );
  });
});
