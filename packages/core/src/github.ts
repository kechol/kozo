/** A repository on GitHub as `<owner>/<name>`. */
export type GitHubRepository = string;

export interface GitHubComment {
  /** The comment's REST ID, which editing it takes. */
  id: number;
  author: string;
  body: string;
}

export interface GitHubIssue {
  number: number;
  title: string;
  body: string;
  author: string;
  state: "open" | "closed";
  labels: string[];
  createdAt: string;
  updatedAt: string;
}

/** What a user may do in a repository, as GitHub names it. */
export type GitHubPermission = "admin" | "maintain" | "write" | "triage" | "read" | "none";

export interface GitHubPull {
  number: number;
  url: string;
  state: "open" | "closed" | "merged";
  /** The branch the pull request merges, without `refs/heads/`. */
  head: string;
  headSha: string;
  mergeCommit: string | null;
}

export interface GitHubCheck {
  name: string;
  bucket: "pass" | "fail" | "pending" | "skipping" | "cancel";
}

/**
 * What kozod does on GitHub, and nothing more: there is no merge and no free-form API call.
 * Bodies are data from requests and runs, so implementations never put them on a command line.
 */
export interface GitHub {
  /** Open Issues, optionally only those with every one of `labels`. */
  issues(repository: GitHubRepository, labels?: readonly string[]): Promise<GitHubIssue[]>;
  comments(repository: GitHubRepository, issue: number): Promise<GitHubComment[]>;
  comment(repository: GitHubRepository, issue: number, body: string): Promise<void>;
  editComment(repository: GitHubRepository, comment: number, body: string): Promise<void>;
  label(
    repository: GitHubRepository,
    issue: number,
    change: { add?: readonly string[]; remove?: readonly string[] },
  ): Promise<void>;
  createLabel(
    repository: GitHubRepository,
    label: { name: string; color: string; description: string },
  ): Promise<void>;
  createPull(
    repository: GitHubRepository,
    pull: { head: string; base: string; title: string; body: string },
  ): Promise<GitHubPull>;
  /** Rewrites an open pull request's body. */
  updatePull(repository: GitHubRepository, pull: number, body: string): Promise<void>;
  /** The pull requests from `head` in the repository itself, never from a fork. */
  pullsFor(repository: GitHubRepository, head: string): Promise<GitHubPull[]>;
  checks(repository: GitHubRepository, pull: number): Promise<GitHubCheck[]>;
  /** The login gh acts as on github.com, which kozod's own comments carry as their author. */
  login(): Promise<string>;
  permission(repository: GitHubRepository, login: string): Promise<GitHubPermission>;
  /** Who added `label` to the Issue most recently, or null when nobody has. */
  labelledBy(repository: GitHubRepository, issue: number, label: string): Promise<string | null>;
  /** Pushes `commit` to `branch` on the clone's `origin`, replacing only what kozo pushed. */
  push(clone: string, branch: string, commit: string): Promise<void>;
  /** The commit `branch` points at on the clone's `origin`, or null when it has none. */
  remoteBranch(clone: string, branch: string): Promise<string | null>;
}
