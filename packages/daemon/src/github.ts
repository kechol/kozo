import type {
  GitHub,
  GitHubCheck,
  GitHubComment,
  GitHubIssue,
  GitHubPull,
  GitHubRepository,
} from "@kozo/core";
import { git } from "@kozo/verify";

/** A gh command line outside the list, refused before gh runs. */
export class GhRefused extends Error {}

/** gh exited with a status that the call does not expect. */
export class GhError extends Error {
  constructor(
    message: string,
    readonly code: number,
  ) {
    super(message);
  }
}

export type GhExec = (
  args: readonly string[],
  stdin?: string,
) => Promise<{ stdout: string; stderr: string; code: number }>;

// Every gh command kozod may run. There is no merge, and the one API call edits a comment.
const listed = new Set([
  "issue list",
  "issue view",
  "issue comment",
  "issue edit",
  "label create",
  "pr create",
  "pr list",
  "pr checks",
  "auth status",
]);
const commentEndpoint = /^repos\/[A-Za-z0-9-]+\/[A-Za-z0-9._-]+\/issues\/comments\/[0-9]+$/;

/** Whether kozod may run gh with `args`. */
export function ghAllowed(args: readonly string[]): boolean {
  if (args[0] === "api") {
    return (
      args.length === 6 &&
      args[1] === "--method" &&
      args[2] === "PATCH" &&
      commentEndpoint.test(args[3] ?? "") &&
      args[4] === "--field" &&
      args[5] === "body=@-"
    );
  }
  return listed.has(`${args[0]} ${args[1]}`);
}

/** Runs gh with kozod's own environment, which holds gh's sign-in; workers never get it. */
export const spawnGh: GhExec = async (args, stdin) => {
  const child = Bun.spawn(["gh", ...args], {
    stdin: stdin === undefined ? "ignore" : new TextEncoder().encode(stdin),
    stdout: "pipe",
    stderr: "pipe",
    timeout: 60_000,
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { stdout, stderr, code };
};

/** git with gh as its only credential helper, so that pushes use gh's sign-in. */
const gitWithGh = (clone: string, args: readonly string[]) =>
  git(clone, [
    "-c",
    "credential.helper=",
    "-c",
    "credential.helper=!gh auth git-credential",
    ...args,
  ]);

/** The `GitHub` of gh, refusing any command line outside the list. */
export function ghGitHub(exec: GhExec = spawnGh): GitHub {
  const gh = async (args: string[], options: { stdin?: string; ok?: number[] } = {}) => {
    if (!ghAllowed(args)) throw new GhRefused(`gh ${args.slice(0, 2).join(" ")} is not allowed`);
    const result = await exec(args, options.stdin);
    if (result.code !== 0 && !options.ok?.includes(result.code)) {
      throw new GhError(`gh ${args.slice(0, 2).join(" ")}: ${result.stderr.trim()}`, result.code);
    }
    return result.stdout;
  };
  const json = async <T>(args: string[], ok?: number[]) => JSON.parse(await gh(args, { ok })) as T;

  return {
    async issues(repository, labels = []) {
      const raw = await json<RawIssue[]>([
        "issue",
        "list",
        `--repo=${repository}`,
        "--state=open",
        "--limit=200",
        "--json=number,title,body,author,state,labels,updatedAt",
        ...labels.map((label) => `--label=${label}`),
      ]);
      return raw.map(issueOf);
    },
    async comments(repository, issue) {
      const raw = await json<{ comments: RawComment[] }>([
        "issue",
        "view",
        String(issue),
        `--repo=${repository}`,
        "--json=comments",
      ]);
      return raw.comments.flatMap(commentOf);
    },
    async comment(repository, issue, body) {
      await gh(["issue", "comment", String(issue), `--repo=${repository}`, "--body-file=-"], {
        stdin: body,
      });
    },
    async editComment(repository, comment, body) {
      await gh(
        [
          "api",
          "--method",
          "PATCH",
          `repos/${repository}/issues/comments/${comment}`,
          "--field",
          "body=@-",
        ],
        { stdin: body },
      );
    },
    async label(repository, issue, { add = [], remove = [] }) {
      if (add.length === 0 && remove.length === 0) return;
      await gh([
        "issue",
        "edit",
        String(issue),
        `--repo=${repository}`,
        ...add.map((label) => `--add-label=${label}`),
        ...remove.map((label) => `--remove-label=${label}`),
      ]);
    },
    async createLabel(repository, { name, color, description }) {
      await gh([
        "label",
        "create",
        name,
        `--repo=${repository}`,
        `--color=${color}`,
        `--description=${description}`,
        "--force",
      ]);
    },
    async createPull(repository, { head, base, title, body }) {
      await gh(
        [
          "pr",
          "create",
          `--repo=${repository}`,
          `--head=${head}`,
          `--base=${base}`,
          `--title=${title}`,
          "--body-file=-",
        ],
        { stdin: body },
      );
      const created = (await this.pullsFor(repository, head)).find((pull) => pull.state === "open");
      if (!created) throw new GhError(`no open pull request for ${head} after creating it`, 0);
      return created;
    },
    async pullsFor(repository, head) {
      const raw = await json<RawPull[]>([
        "pr",
        "list",
        `--repo=${repository}`,
        `--head=${head}`,
        "--state=all",
        "--json=number,url,state,headRefName,headRefOid,mergeCommit,isCrossRepository",
      ]);
      // A fork can name its branch like a task branch; only the repository's own branch counts.
      return raw.filter((pull) => !pull.isCrossRepository).map(pullOf);
    },
    async checks(repository, pull) {
      // gh pr checks exits 8 while checks are pending; the output still lists them.
      const raw = await json<GitHubCheck[]>(
        ["pr", "checks", String(pull), `--repo=${repository}`, "--json=name,bucket"],
        [8],
      );
      return raw.map(({ name, bucket }) => ({ name, bucket }));
    },
    async login() {
      const raw = await json<{ hosts: Record<string, { active: boolean; login: string }[]> }>([
        "auth",
        "status",
        "--active",
        "--hostname=github.com",
        "--json=hosts",
      ]);
      const login = raw.hosts["github.com"]?.find((account) => account.active)?.login;
      if (!login) throw new GhError("gh is not signed in to github.com", 0);
      return login;
    },
    async push(clone, branch, commit) {
      await gitWithGh(clone, [
        "push",
        "--porcelain",
        `--force-with-lease=refs/heads/${branch}`,
        "origin",
        `${commit}:refs/heads/${branch}`,
      ]);
    },
    async remoteBranch(clone, branch) {
      const listed = await gitWithGh(clone, ["ls-remote", "origin", `refs/heads/${branch}`]);
      return listed.trim().split(/\s+/)[0] || null;
    },
  };
}

interface RawIssue {
  number: number;
  title: string;
  body: string;
  author: { login: string };
  state: string;
  labels: { name: string }[];
  updatedAt: string;
}

interface RawComment {
  author: { login: string };
  body: string;
  url: string;
}

interface RawPull {
  number: number;
  url: string;
  state: string;
  headRefName: string;
  headRefOid: string;
  mergeCommit: { oid: string } | null;
  isCrossRepository: boolean;
}

const issueOf = (raw: RawIssue): GitHubIssue => ({
  number: raw.number,
  title: raw.title,
  body: raw.body,
  author: raw.author.login,
  state: raw.state.toLowerCase() === "open" ? "open" : "closed",
  labels: raw.labels.map((label) => label.name),
  updatedAt: raw.updatedAt,
});

// gh gives a comment's node ID; editing takes the REST ID at the end of its URL.
const commentOf = (raw: RawComment): GitHubComment[] => {
  const id = /#issuecomment-([0-9]+)$/.exec(raw.url)?.[1];
  return id ? [{ id: Number(id), author: raw.author.login, body: raw.body }] : [];
};

const pullOf = (raw: RawPull): GitHubPull => ({
  number: raw.number,
  url: raw.url,
  state: raw.state.toLowerCase() as GitHubPull["state"],
  head: raw.headRefName,
  headSha: raw.headRefOid,
  mergeCommit: raw.mergeCommit?.oid ?? null,
});

/** Pushes, and when the push fails, takes it as done only if origin shows the commit. */
export async function pushConfirmed(
  github: GitHub,
  clone: string,
  branch: string,
  commit: string,
): Promise<void> {
  try {
    await github.push(clone, branch, commit);
  } catch (error) {
    const remote = await github.remoteBranch(clone, branch).catch(() => null);
    if (remote !== commit) throw error;
  }
}

/**
 * Posts kozod's comment marked `marker` on an Issue, or edits it when it is already there. A
 * comment whose response was lost is looked for before the error goes on, so that the next try
 * edits it instead of posting it twice. Only comments by `self`, kozod's own login, count: anyone
 * can write the marker into a comment of theirs.
 */
export async function upsertComment(
  github: GitHub,
  self: string,
  repository: GitHubRepository,
  issue: number,
  marker: string,
  body: string,
): Promise<void> {
  const tag = `<!-- ${marker} -->`;
  const text = `${body}\n\n${tag}`;
  const find = async () =>
    (await github.comments(repository, issue)).find(
      (comment) => comment.author === self && comment.body.endsWith(tag),
    );
  const existing = await find();
  if (existing) {
    if (existing.body !== text) await github.editComment(repository, existing.id, text);
    return;
  }
  try {
    await github.comment(repository, issue, text);
  } catch (error) {
    if (!(await find().catch(() => undefined))) throw error;
  }
}
