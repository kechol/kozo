import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { verifierSandbox } from "./judge.ts";
import { deniedCredentials } from "./sandbox.ts";

describe("verifierSandbox", () => {
  test("denies the factory home but for the worktree under test", () => {
    const home = "/factory/home";
    const worktree = join(home, "worktrees", "T-1");
    const sandbox = verifierSandbox(home, worktree);
    expect(sandbox.filesystem.denyRead).toContain(home);
    expect(sandbox.filesystem.denyRead).toEqual(
      expect.arrayContaining(deniedCredentials(process.env)),
    );
    expect(sandbox.filesystem.allowRead).toEqual([worktree]);
    expect(sandbox.failIfUnavailable).toBe(true);
  });
});
