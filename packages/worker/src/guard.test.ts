import { describe, expect, test } from "bun:test";
import { link, mkdir, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tempDirectory } from "@kozo/testing";
import { guardToolCall, type TaskPolicy } from "./guard.ts";
import { parseShell } from "./shell.ts";

async function withPolicy(run: (policy: TaskPolicy, root: string) => Promise<void>) {
  await using dir = await tempDirectory();
  const worktree = join(dir.path, "worktree");
  await mkdir(join(worktree, "src"), { recursive: true });
  await mkdir(join(worktree, "scripts"), { recursive: true });
  await Bun.write(join(worktree, ".git"), "gitdir: /elsewhere\n");
  await Bun.write(join(worktree, "scripts", "ok.sh"), "#!/bin/sh\nbun test\n");
  await Bun.write(join(worktree, "scripts", "sneaky.sh"), "#!/bin/sh\ngit push origin HEAD:main\n");
  await Bun.write(join(worktree, "scripts", "plain"), "git merge main\n");
  await Bun.write(join(dir.path, "outside.sh"), "echo hi\n");
  await symlink(dir.path, join(worktree, "src", "escape"));
  await Bun.write(join(worktree, "src", "cart.ts"), "export {};\n");
  await symlink(join(worktree, "src", "cart.ts"), join(worktree, "src", "alias.ts"));
  await link(join(dir.path, "outside.sh"), join(worktree, "src", "hard.ts"));
  await run(
    {
      worktree,
      scope: ["src/**", "tests/new/**"],
      protectedPaths: ["src/auth/**", ".kozo/**"],
      existingTests: new Set(["src/cart.test.ts"]),
    },
    dir.path,
  );
}

const bash = (command: string) => ["Bash", { command }] as const;

describe("parseShell", () => {
  test("finds the commands inside substitutions, functions and conditionals", () => {
    const names = (source: string) =>
      parseShell(source).commands.map((words) => words.map((word) => word.text).join(" "));
    expect(names("echo $(git push) && f() { git merge x; }")).toEqual([
      "git push",
      "echo ",
      "f",
      "git merge x",
    ]);
    expect(names("if true; then git push; fi")).toEqual(["true", "git push"]);
    expect(parseShell("cat <<EOF | sh\ngit push\nEOF\n").heredocs).toEqual(["git push"]);
    expect(() => parseShell("echo 'open")).toThrow("unclosed single quote");
  });
});

describe("guardToolCall", () => {
  test("allows ordinary work in the worktree", async () => {
    await withPolicy(async (policy) => {
      for (const command of [
        "bun test src/cart.test.ts",
        "git status && git diff --stat",
        "git add -A && git commit -m 'fix: reject a blank quantity'",
        "git log --oneline -5 | head -3",
        "git branch --show-current",
        "git checkout -- src/cart.ts",
        "git config --get user.name",
        "git rebase --continue",
        "git grep -n cart",
        'git commit -m "$(cat <<EOF\nfix: reject a blank quantity\nEOF\n)"',
        "git diff -- $FILE",
        "git rebase main",
        "git checkout HEAD -- src/cart.ts",
        "sh scripts/ok.sh",
        "./scripts/ok.sh",
        "find src -name '*.ts' -exec grep -l cart {} +",
        "NODE_ENV=test bun test",
        "x=$((1 + 2)); echo $x",
      ]) {
        expect({ command, decision: await guardToolCall(...bash(command), policy) }).toEqual({
          command,
          decision: { allow: true },
        });
      }
      expect(await guardToolCall("Read", { file_path: "src/cart.ts" }, policy)).toEqual({
        allow: true,
      });
      expect(await guardToolCall("Write", { file_path: "src/cart.ts" }, policy)).toEqual({
        allow: true,
      });
      expect(await guardToolCall("Grep", { pattern: "cart", path: "src" }, policy)).toEqual({
        allow: true,
      });
      expect(await guardToolCall("mcp__kozo__gates", { level: "fast" }, policy)).toEqual({
        allow: true,
      });
      expect(await guardToolCall("StructuredOutput", { word: "done" }, policy)).toEqual({
        allow: true,
      });
    });
  });

  test("refuses pushes, merges, ref updates and GitHub, however they are spelled", async () => {
    await withPolicy(async (policy) => {
      for (const command of [
        "git push origin HEAD:main",
        "git merge main",
        "git pull",
        "git update-ref refs/heads/main HEAD",
        "git branch -f main HEAD",
        "git branch other",
        "git switch main",
        "git checkout main",
        "git checkout -b other",
        "git tag v1",
        "git config alias.p push",
        "git -c alias.p=push p",
        "git --git-dir=../repo/.git log",
        "git -C .. push",
        "GIT_DIR=../repo/.git git commit -m x",
        "export GIT_DIR=../repo/.git",
        "git rebase --exec 'git push' main",
        "gh pr merge 1",
        "echo ok; git push",
        "echo $(git push)",
        "echo `git update-ref refs/heads/main HEAD`",
        'bash -c "git push"',
        "sh -c 'git merge main'",
        "eval git push",
        'eval "$CMD"',
        "$GIT push",
        "env -S 'git push'",
        "env FOO=1 git push",
        "command git push",
        "xargs git push < refs.txt",
        "find . -exec git push \\;",
        "sh scripts/sneaky.sh",
        "./scripts/sneaky.sh",
        "./scripts/plain",
        "sh ../outside.sh",
        "echo 'git push' | sh",
        "cat <<EOF | bash\ngit push\nEOF\n",
        "alias ls='git push'",
        "sudo rm -rf /",
        "open -a Terminal",
        "echo 'unclosed",
        "git frobnicate",
        // biome-ignore lint/suspicious/noTemplateCurlyInString: shell text, not a template.
        "echo ${x:-$(git push)}",
        "echo $(( $(git push) ))",
        "git rebase --exe 'git push' main",
        "git rebase -i main",
        "git checkout --orph other --",
        "git config --ad alias.p push",
        "git config --replace-all user.name x",
        "git bisect run git push",
        "git grep -O foo",
        "git grep -nOless foo",
        "git grep --open-files foo",
        'git grep "-$X" foo',
        "git log $OPTS",
        'git grep -F "$X" src',
        'git diff "$SEP" "$X"',
        "git help -w push",
        "sleep 10 &",
        "nohup bun run dev",
        "echo 'git push' > scripts/ok.sh && sh scripts/ok.sh",
        "bash -c 'echo x > scripts/ok.sh; sh scripts/ok.sh'",
      ]) {
        const decision = await guardToolCall(...bash(command), policy);
        expect({ command, allow: decision.allow }).toEqual({ command, allow: false });
      }
    });
  });

  test("keeps the file tools inside the worktree, out of .git and away from what a task may not write", async () => {
    await withPolicy(async (policy, root) => {
      const reasons = async (tool: string, input: object) => {
        const decision = await guardToolCall(tool, input, policy);
        return decision.allow ? "allowed" : decision.reason;
      };
      expect(await reasons("Read", { file_path: join(root, "outside.sh") })).toContain(
        "outside the worktree",
      );
      expect(await reasons("Read", { file_path: "../outside.sh" })).toContain(
        "outside the worktree",
      );
      expect(await reasons("Read", { file_path: "src/escape/outside.sh" })).toContain(
        "outside the worktree",
      );
      expect(await reasons("Read", { file_path: ".git" })).toContain("outside the worktree");
      expect(await reasons("Glob", { pattern: "/etc/*" })).toContain("reaches outside");
      expect(await reasons("Grep", { pattern: "x", glob: "../**" })).toContain("reaches outside");
      expect(await reasons("Write", { file_path: "src/auth/session.ts" })).toContain(
        "protected path",
      );
      expect(await reasons("Edit", { file_path: ".kozo/charter.yml" })).toContain("protected path");
      expect(await reasons("Write", { file_path: "README.md" })).toContain(
        "outside the task's scope",
      );
      expect(await reasons("Edit", { file_path: "src/cart.test.ts" })).toContain("existing test");
      expect(await reasons("Write", { file_path: "tests/new/cart.test.ts" })).toBe("allowed");
      expect(await reasons("WebFetch", { url: "https://example.com" })).toContain("not a tool");
      expect(await reasons("Edit", { file_path: "src/alias.ts" })).toContain("symbolic link");
      expect(await reasons("Read", { file_path: "src/hard.ts" })).toContain("hard link");
      expect(await reasons("Write", { file_path: "src/hard.ts" })).toContain("hard link");
    });
  });
});
