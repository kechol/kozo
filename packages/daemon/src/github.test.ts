import { describe, expect, test } from "bun:test";
import { fakeGitHub, gitRepository, tempDirectory } from "@kozo/testing";
import {
  GhError,
  type GhExec,
  ghAllowed,
  ghGitHub,
  pushConfirmed,
  upsertComment,
} from "./github.ts";

function recording(stdout: (args: readonly string[]) => string = () => "[]", code = 0) {
  const calls: { args: readonly string[]; stdin?: string }[] = [];
  const exec: GhExec = async (args, stdin) => {
    calls.push({ args, stdin });
    return { stdout: stdout(args), stderr: "", code };
  };
  return { calls, exec };
}

describe("ghAllowed", () => {
  test("allows only the listed commands and the one comment edit", () => {
    for (const args of [
      ["issue", "list", "--repo=me/app"],
      ["issue", "comment", "12", "--body-file=-"],
      ["pr", "create", "--head=kozo/x/12-t1"],
      ["pr", "checks", "3"],
      ["api", "--method", "PATCH", "repos/me/app/issues/comments/99", "--field", "body=@-"],
      ["api", "--method", "GET", "repos/me/app/collaborators/someone/permission"],
      ["pr", "edit", "3", "--repo=me/app", "--body-file=-"],
      ["api", "--method", "GET", "--paginate", "--slurp", "repos/me/app/issues/12/events"],
      ["issue", "close", "12", "--repo=me/app", "--reason=completed"],
    ]) {
      expect({ args, allowed: ghAllowed(args) }).toEqual({ args, allowed: true });
    }
    for (const args of [
      ["pr", "merge", "3"],
      ["pr", "review", "3", "--approve"],
      ["issue", "close", "12"],
      ["issue", "close", "12", "--repo=me/app", "--reason=not planned"],
      ["issue", "close", "12", "--repo=me/app", "--comment=done"],
      ["repo", "delete", "me/app"],
      ["auth", "token"],
      ["secret", "list"],
      ["workflow", "run", "deploy"],
      ["release", "create", "v1"],
      ["api", "repos/me/app/pulls/3/merge", "--method", "PUT"],
      ["api", "--method", "PUT", "repos/me/app/pulls/3/merge", "--field", "body=@-"],
      ["api", "--method", "PATCH", "repos/me/app/issues/comments/99", "--field", "body=x"],
      ["api", "graphql", "-f", "query=mutation"],
      ["pr", "edit", "3", "--repo=me/app", "--base=release"],
      ["api", "--method", "GET", "--paginate", "--slurp", "repos/me/app/issues/12/comments"],
      ["api", "--method", "GET", "--paginate", "repos/me/app/issues/12/events"],
      ["pr", "edit", "3", "--repo=me/app", "--body-file=-", "--add-reviewer=x"],
      ["api", "--method", "GET", "repos/me/app/collaborators"],
      ["api", "--method", "GET", "repos/me/app/collaborators/x/permission", "--paginate"],
      ["--repo", "me/app", "pr", "merge"],
    ]) {
      expect({ args, allowed: ghAllowed(args) }).toEqual({ args, allowed: false });
    }
  });

  test("every method runs a listed command line and passes bodies on stdin", async () => {
    const { calls, exec } = recording((args) =>
      args[0] === "issue" && args[1] === "view"
        ? JSON.stringify(
            args.includes("--json=comments")
              ? { comments: [] }
              : {
                  number: 12,
                  title: "t",
                  body: "b",
                  author: { login: "someone" },
                  state: "CLOSED",
                  stateReason: "NOT_PLANNED",
                  labels: [{ name: "kozo" }],
                  createdAt: "2026-10-22T00:00:00Z",
                  updatedAt: "2026-10-22T00:00:00Z",
                },
          )
        : args[1] === "list" && args[0] === "pr"
          ? JSON.stringify([
              {
                number: 3,
                url: "u",
                state: "OPEN",
                headRefName: "kozo/x/12-t1",
                headRefOid: "abc",
                mergeCommit: null,
                isCrossRepository: false,
              },
              {
                number: 4,
                url: "u",
                state: "MERGED",
                headRefName: "kozo/x/12-t1",
                headRefOid: "def",
                mergeCommit: { oid: "fff" },
                isCrossRepository: true,
              },
            ])
          : "[]",
    );
    const github = ghGitHub(exec);
    await github.issues("me/app", ["kozo:accept"]);
    await github.comments("me/app", 12);
    expect(await github.issue("me/app", 12)).toMatchObject({
      state: "closed",
      reason: "not_planned",
      labels: ["kozo"],
    });
    await github.comment("me/app", 12, "--body text; rm -rf /");
    await github.editComment("me/app", 99, "edited");
    await github.label("me/app", 12, { add: ["kozo:triage"], remove: ["kozo:intake"] });
    await github.createLabel("me/app", { name: "kozo:triage", color: "ededed", description: "d" });
    await github.createPull("me/app", {
      head: "kozo/x/12-t1",
      base: "main",
      title: "--draft",
      body: "Part of #12",
    });
    await github.checks("me/app", 3);
    await github.updatePull("me/app", 3, "Part of #12");
    expect((await github.pullsFor("me/app", "kozo/x/12-t1")).map((pull) => pull.number)).toEqual([
      3,
    ]);
    for (const { args } of calls)
      expect({ args, allowed: ghAllowed(args) }).toMatchObject({ allowed: true });
    expect(calls.find((call) => call.args[1] === "comment")).toEqual({
      args: ["issue", "comment", "12", "--repo=me/app", "--body-file=-"],
      stdin: "--body text; rm -rf /",
    });
    expect(
      calls.find((call) => call.args[1] === "create" && call.args[0] === "pr")?.args,
    ).toContain("--title=--draft");
    expect(calls.find((call) => call.args[0] === "api")?.stdin).toBe("edited");
  });

  test("finds who added a label last, across pages", async () => {
    const event = (kind: string, login: string, name: string) => ({
      event: kind,
      actor: { login },
      label: { name },
    });
    const { exec } = recording(() =>
      JSON.stringify([
        [event("labeled", "owner", "kozo:accept"), event("labeled", "triager", "bug")],
        [event("unlabeled", "owner", "kozo:accept"), event("labeled", "triager", "kozo:accept")],
      ]),
    );
    expect(await ghGitHub(exec).labelledBy("me/app", 12, "kozo:accept")).toBe("triager");
    expect(await ghGitHub(exec).labelledBy("me/app", 12, "kozo:paused")).toBeNull();
  });

  test("pending checks are not an error, and other failures are", async () => {
    const pending = recording(() => JSON.stringify([{ name: "ci", bucket: "pending" }]), 8);
    expect(await ghGitHub(pending.exec).checks("me/app", 3)).toEqual([
      { name: "ci", bucket: "pending" },
    ]);
    const failed = recording(() => "", 1);
    await expect(ghGitHub(failed.exec).issues("me/app")).rejects.toThrow(GhError);
  });
});

describe("pushes and comments whose response is lost", () => {
  test("a push counts only when origin shows the commit", async () => {
    const github = fakeGitHub();
    github.lose("push", "after");
    await pushConfirmed(github, "/clone", "kozo/x/12-t1", "abc");
    expect(await github.remoteBranch("/clone", "kozo/x/12-t1")).toBe("abc");
    github.lose("push", "before");
    await expect(pushConfirmed(github, "/clone", "kozo/x/12-t1", "def")).rejects.toThrow(
      "the push response was lost",
    );
  });

  test("a marked comment is posted once and edited after", async () => {
    const github = fakeGitHub();
    const issue = github.addIssue("me/app", { title: "Low stock" });
    const bodies = () =>
      (github.repositories.get("me/app")?.issues[0]?.comments ?? []).map((comment) => comment.body);

    const post = (body: string) =>
      upsertComment(github, "kozo", "me/app", issue, "kozo:status", body);
    github.repositories.get("me/app")?.issues[0]?.comments.push({
      id: 1,
      author: "someone",
      body: "I can write <!-- kozo:status --> too",
    });

    github.lose("comment", "before");
    await expect(post("Triage")).rejects.toThrow();
    expect(bodies()).toHaveLength(1);

    github.lose("comment", "after");
    await post("Triage");
    await post("Triage");
    await post("Building");
    expect(bodies()).toEqual([
      "I can write <!-- kozo:status --> too",
      "Building\n\n<!-- kozo:status -->",
    ]);
  });
});

describe("pushing with git", () => {
  test("pushes a commit to origin and reads the branch back", async () => {
    await using remote = await tempDirectory();
    await using clone = await gitRepository();
    const commit = (await clone.commit({ "a.txt": "1\n" })).trim();
    Bun.spawnSync(["git", "init", "--quiet", "--bare", remote.path]);
    await clone.git("remote", "add", "origin", remote.path);
    const github = ghGitHub(recording().exec);
    expect(await github.remoteBranch(clone.path, "kozo/x/12-t1")).toBeNull();
    await github.push(clone.path, "kozo/x/12-t1", commit);
    expect(await github.remoteBranch(clone.path, "kozo/x/12-t1")).toBe(commit);
  });
});
