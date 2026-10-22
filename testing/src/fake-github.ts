import type {
  GitHub,
  GitHubCheck,
  GitHubComment,
  GitHubIssue,
  GitHubPull,
  GitHubRepository,
} from "@kozo/core";

/** How the next call of a kind fails: its response is lost after the change lands, or before. */
export type Loss = "after" | "before";

interface FakeIssue extends GitHubIssue {
  comments: GitHubComment[];
}

export interface FakeGitHub extends GitHub {
  /** Every call, as `<method> <repository or clone> <subject>`, in order. */
  readonly calls: string[];
  readonly repositories: Map<GitHubRepository, { issues: FakeIssue[]; pulls: GitHubPull[] }>;
  /** Branch tips on each clone's origin, by `<clone> <branch>`. */
  readonly branches: Map<string, string>;
  checksOf: Map<number, GitHubCheck[]>;
  addIssue(repository: GitHubRepository, issue: Partial<GitHubIssue> & { title: string }): number;
  /** Makes the next `comment` or `push` lose its response, after or before the change. */
  lose(method: "comment" | "push", loss: Loss): void;
}

/** An in-memory GitHub with the gh wrapper's interface, for kozod's tests. */
export function fakeGitHub(): FakeGitHub {
  const calls: string[] = [];
  const repositories = new Map<GitHubRepository, { issues: FakeIssue[]; pulls: GitHubPull[] }>();
  const branches = new Map<string, string>();
  const losses = new Map<"comment" | "push", Loss>();
  let nextId = 1000;
  const repositoryOf = (repository: GitHubRepository) => {
    const found = repositories.get(repository) ?? { issues: [], pulls: [] };
    repositories.set(repository, found);
    return found;
  };
  const issueOf = (repository: GitHubRepository, number: number) => {
    const issue = repositoryOf(repository).issues.find((entry) => entry.number === number);
    if (!issue) throw new Error(`${repository}#${number} does not exist`);
    return issue;
  };
  /** Runs `change` as the lost call says: not at all, or before throwing. */
  const withLoss = (method: "comment" | "push", change: () => void) => {
    const loss = losses.get(method);
    losses.delete(method);
    if (loss !== "before") change();
    if (loss) throw new Error(`the ${method} response was lost`);
  };

  return {
    calls,
    repositories,
    branches,
    checksOf: new Map(),
    addIssue(repository, issue) {
      const entry = repositoryOf(repository);
      const number = entry.issues.length + entry.pulls.length + 1;
      entry.issues.push({
        number,
        body: "",
        author: "owner",
        state: "open",
        labels: [],
        updatedAt: new Date().toISOString(),
        comments: [],
        ...issue,
      });
      return number;
    },
    lose(method, loss) {
      losses.set(method, loss);
    },
    async issues(repository, labels = []) {
      calls.push(`issues ${repository}`);
      return repositoryOf(repository)
        .issues.filter((issue) => issue.state === "open")
        .filter((issue) => labels.every((label) => issue.labels.includes(label)))
        .map(({ comments: _comments, ...issue }) => ({ ...issue, labels: [...issue.labels] }));
    },
    async comments(repository, issue) {
      calls.push(`comments ${repository} #${issue}`);
      return issueOf(repository, issue).comments.map((comment) => ({ ...comment }));
    },
    async comment(repository, issue, body) {
      calls.push(`comment ${repository} #${issue}`);
      const target = issueOf(repository, issue);
      withLoss("comment", () => {
        target.comments.push({ id: nextId++, author: "kozo", body });
      });
    },
    async editComment(repository, comment, body) {
      calls.push(`editComment ${repository} ${comment}`);
      const found = repositoryOf(repository)
        .issues.flatMap((issue) => issue.comments)
        .find((entry) => entry.id === comment);
      if (!found) throw new Error(`comment ${comment} does not exist`);
      found.body = body;
    },
    async label(repository, issue, { add = [], remove = [] }) {
      calls.push(`label ${repository} #${issue}`);
      const target = issueOf(repository, issue);
      target.labels = [...new Set([...target.labels.filter((l) => !remove.includes(l)), ...add])];
    },
    async createLabel(repository, { name }) {
      calls.push(`createLabel ${repository} ${name}`);
    },
    async createPull(repository, { head }) {
      calls.push(`createPull ${repository} ${head}`);
      const entry = repositoryOf(repository);
      const pull: GitHubPull = {
        number: entry.issues.length + entry.pulls.length + 1,
        url: `https://github.example/${repository}/pull/${entry.issues.length + entry.pulls.length + 1}`,
        state: "open",
        head,
        headSha: "",
        mergeCommit: null,
      };
      entry.pulls.push(pull);
      return { ...pull };
    },
    async pullsFor(repository, head) {
      calls.push(`pullsFor ${repository} ${head}`);
      return repositoryOf(repository)
        .pulls.filter((pull) => pull.head === head)
        .map((pull) => ({ ...pull }));
    },
    async checks(repository, pull) {
      calls.push(`checks ${repository} #${pull}`);
      return [...(this.checksOf.get(pull) ?? [])];
    },
    async push(clone, branch, commit) {
      calls.push(`push ${clone} ${branch}`);
      withLoss("push", () => {
        branches.set(`${clone} ${branch}`, commit);
      });
    },
    async remoteBranch(clone, branch) {
      calls.push(`remoteBranch ${clone} ${branch}`);
      return branches.get(`${clone} ${branch}`) ?? null;
    },
  };
}
