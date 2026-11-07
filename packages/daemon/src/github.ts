import type {
  GitHub,
  GitHubCheck,
  GitHubComment,
  GitHubIssue,
  GitHubPull,
  GitHubRepository,
  GitHubReview,
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

// Every gh command kozod may run. There is no merge, and the API calls edit a comment or read a
// user's permission.
const listed = new Set([
  "issue list",
  "issue view",
  "issue comment",
  "label create",
  "pr create",
  "pr list",
  "pr checks",
  "auth status",
]);
const commentEndpoint = /^repos\/[A-Za-z0-9-]+\/[A-Za-z0-9._-]+\/issues\/comments\/[0-9]+$/;
const eventsEndpoint = /^repos\/[A-Za-z0-9-]+\/[A-Za-z0-9._-]+\/issues\/[0-9]+\/events$/;
const permissionEndpoint =
  /^repos\/[A-Za-z0-9-]+\/[A-Za-z0-9._-]+\/collaborators\/[A-Za-z0-9-]+\/permission$/;

/** The most open Issues kozod reads in one listing. */
export const openIssueLimit = 10_000;

/** Whether kozod may run gh with `args`. */
export function ghAllowed(args: readonly string[]): boolean {
  // kozod opens an Issue only for a local item it moves to GitHub, with its title, its request
  // and the intake label.
  if (args[0] === "issue" && args[1] === "create") {
    return (
      (args.length === 5 || (args.length === 6 && (args[5] ?? "").startsWith("--label="))) &&
      (args[2] ?? "").startsWith("--repo=") &&
      (args[3] ?? "").startsWith("--title=") &&
      args[4] === "--body-file=-"
    );
  }
  // An Issue's labels are the one thing kozod edits on it: no title, body, assignee or state.
  if (args[0] === "issue" && args[1] === "edit") {
    const changes = args.slice(4);
    return (
      changes.length > 0 &&
      /^[0-9]+$/.test(args[2] ?? "") &&
      (args[3] ?? "").startsWith("--repo=") &&
      changes.every((arg) => /^--(add|remove)-label=/.test(arg))
    );
  }
  // kozod closes an Issue only as completed, after it checked the item's DONE_WHEN.
  if (args[0] === "issue" && args[1] === "close") {
    return (
      args.length === 5 &&
      /^[0-9]+$/.test(args[2] ?? "") &&
      (args[3] ?? "").startsWith("--repo=") &&
      args[4] === "--reason=completed"
    );
  }
  // A pull request's body is the one thing kozod edits on it: no title, base, state or reviewer.
  if (args[0] === "pr" && args[1] === "edit") {
    return (
      args.length === 5 &&
      /^[0-9]+$/.test(args[2] ?? "") &&
      (args[3] ?? "").startsWith("--repo=") &&
      args[4] === "--body-file=-"
    );
  }
  if (args[0] === "api" && args[2] === "GET") {
    if (args[3] === "--paginate") {
      return (
        args.length === 6 &&
        args[1] === "--method" &&
        args[4] === "--slurp" &&
        eventsEndpoint.test(args[5] ?? "")
      );
    }
    return args.length === 4 && args[1] === "--method" && permissionEndpoint.test(args[3] ?? "");
  }
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
// A fetch or a push that the network holds up would otherwise stop every job queued behind it.
const networkTimeoutMs = 300_000;

const gitWithGh = (clone: string, args: readonly string[]) =>
  git(
    clone,
    ["-c", "credential.helper=", "-c", "credential.helper=!gh auth git-credential", ...args],
    { timeoutMs: networkTimeoutMs },
  );

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
  const events = async (repository: string, issue: number) =>
    (
      await json<{ event: string; actor: { login: string } | null; label?: { name: string } }[][]>([
        "api",
        "--method",
        "GET",
        "--paginate",
        "--slurp",
        `repos/${repository}/issues/${issue}/events`,
      ])
    ).flat();

  return {
    issueLimit: openIssueLimit,
    async issues(repository, labels = []) {
      const raw = await json<RawIssue[]>([
        "issue",
        "list",
        `--repo=${repository}`,
        "--state=open",
        // gh pages through them all up to the limit, which no intake queue reaches.
        `--limit=${openIssueLimit}`,
        `--json=${issueFields}`,
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
    async issue(repository, issue) {
      return issueOf(
        await json<RawIssue>([
          "issue",
          "view",
          String(issue),
          `--repo=${repository}`,
          `--json=${issueFields}`,
        ]),
      );
    },
    async createIssue(repository, { title, body, labels }) {
      // gh looks the labels up before it opens the Issue, and prints the new Issue's URL, which
      // ends in its number.
      const url = await gh(
        [
          "issue",
          "create",
          `--repo=${repository}`,
          `--title=${title}`,
          "--body-file=-",
          ...labels.map((label) => `--label=${label}`),
        ],
        {
          stdin: body,
        },
      );
      const number = Number(url.trim().match(/\/issues\/(\d+)$/)?.[1]);
      if (!Number.isInteger(number)) throw new GhRefused(`gh issue create printed ${url.trim()}`);
      return number;
    },
    async closeIssue(repository, issue) {
      await gh(["issue", "close", String(issue), `--repo=${repository}`, "--reason=completed"]);
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
    async updatePull(repository, pull, body) {
      await gh(["pr", "edit", String(pull), `--repo=${repository}`, "--body-file=-"], {
        stdin: body,
      });
    },
    async pullsFor(repository, head) {
      const raw = await json<RawPull[]>([
        "pr",
        "list",
        `--repo=${repository}`,
        `--head=${head}`,
        "--state=all",
        "--json=number,url,state,headRefName,headRefOid,mergeCommit,isCrossRepository,reviews",
      ]);
      // A fork can name its branch like a task branch; only the repository's own branch counts.
      return raw.filter((pull) => !pull.isCrossRepository).map(pullOf);
    },
    async checks(repository, pull) {
      // gh pr checks exits 8 while checks are pending; the output still lists them.
      return await json<GitHubCheck[]>(
        ["pr", "checks", String(pull), `--repo=${repository}`, "--json=name,bucket"],
        [8],
      );
    },
    async permission(repository, login) {
      // A login outside GitHub's alphabet, such as a bot's `name[bot]`, has no permission to ask
      // for and would not pass the list.
      if (!/^[A-Za-z0-9-]+$/.test(login)) return "none";
      try {
        const raw = await json<{ permission: string; role_name?: string }>([
          "api",
          "--method",
          "GET",
          `repos/${repository}/collaborators/${login}/permission`,
        ]);
        const role = raw.role_name ?? raw.permission;
        return (
          (["admin", "maintain", "write", "triage", "read"] as const).find(
            (name) => name === role,
          ) ?? "none"
        );
      } catch (error) {
        // GitHub answers 404 for a login that is no collaborator; any other failure, such as a
        // rate limit, says nothing about the login and must not make a writer look like none.
        if (error instanceof GhError && /\bHTTP 404\b/.test(error.message)) return "none";
        throw error;
      }
    },
    async labelledBy(repository, issue, label) {
      const added = (await events(repository, issue)).filter(
        (event) => event.event === "labeled" && event.label?.name === label,
      );
      return added.at(-1)?.actor?.login ?? null;
    },
    async closedBy(repository, issue) {
      const closed = (await events(repository, issue)).filter((event) => event.event === "closed");
      return closed.at(-1)?.actor?.login ?? null;
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
    async fetch(clone) {
      await gitWithGh(clone, ["fetch", "--quiet", "--prune", "origin"]);
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
  stateReason: string | null;
  labels: { name: string }[];
  createdAt: string;
  updatedAt: string;
}

const issueFields = "number,title,body,author,state,stateReason,labels,createdAt,updatedAt";

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
  reviews?: {
    author: { login: string } | null;
    state: GitHubReview["state"];
    body: string;
    commit: { oid: string } | null;
  }[];
}

const issueOf = (raw: RawIssue): GitHubIssue => {
  const state = raw.state.toLowerCase() === "open" ? "open" : "closed";
  const reason = (raw.stateReason ?? "").toLowerCase();
  return {
    number: raw.number,
    title: raw.title,
    body: raw.body,
    author: raw.author.login,
    state,
    reason:
      state === "closed" &&
      (reason === "completed" || reason === "not_planned" || reason === "duplicate")
        ? reason
        : null,
    labels: raw.labels.map((label) => label.name),
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
};

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
  reviews: (raw.reviews ?? []).map((review) => ({
    author: review.author?.login ?? "",
    state: review.state,
    body: review.body,
    commit: review.commit?.oid ?? "",
  })),
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

/** The hidden tag that ends each comment kozod writes and finds it again by. */
export const commentTag = (marker: string) => `<!-- ${marker} -->`;

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
  const tag = commentTag(marker);
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
