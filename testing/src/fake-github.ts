import type {
  GitHub,
  GitHubCheck,
  GitHubComment,
  GitHubIssue,
  GitHubPermission,
  GitHubPull,
  GitHubRepository,
} from "@kozo/core";

/** How the next call of a kind fails: its response is lost after the change lands, or before. */
export type Loss = "after" | "before";

interface FakeIssue extends GitHubIssue {
  comments: GitHubComment[];
  stateReason?: "completed" | "not_planned" | "duplicate" | null;
}

export interface FakeGitHub extends GitHub {
  /** Every call, as `<method> <repository or clone> <subject>`, in order. */
  readonly calls: string[];
  readonly repositories: Map<GitHubRepository, { issues: FakeIssue[]; pulls: GitHubPull[] }>;
  /** Branch tips on each clone's origin, by `<clone> <branch>`. */
  readonly branches: Map<string, string>;
  checksOf: Map<number, GitHubCheck[]>;
  /** Each pull request's body, by number. */
  bodies: Map<number, string>;
  /**
   * Who added each label last, by `<repository> #<issue> <label>`, and who closed each Issue,
   * by `<repository> #<issue> closed`.
   */
  labellers: Map<string, string>;
  /** Each login's permission, by `<repository> <login>`; anyone else has none. */
  permissions: Map<string, GitHubPermission>;
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
    bodies: new Map(),
    permissions: new Map(),
    labellers: new Map(),
    addIssue(repository, issue) {
      const entry = repositoryOf(repository);
      const number = entry.issues.length + entry.pulls.length + 1;
      entry.issues.push({
        number,
        body: "",
        author: "owner",
        state: "open",
        labels: [],
        createdAt: new Date().toISOString(),
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
    async issueState(repository, issue) {
      calls.push(`issueState ${repository} #${issue}`);
      const found = issueOf(repository, issue);
      return {
        state: found.state,
        reason: found.state === "open" ? null : (found.stateReason ?? null),
        author: found.author,
      };
    },
    async closeIssue(repository, issue) {
      calls.push(`closeIssue ${repository} #${issue}`);
      const found = issueOf(repository, issue);
      found.state = "closed";
      found.stateReason = "completed";
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
    async createPull(repository, { head, body }) {
      calls.push(`createPull ${repository} ${head}`);
      const entry = repositoryOf(repository);
      const pull: GitHubPull = {
        number: entry.issues.length + entry.pulls.length + 1,
        url: `https://github.example/${repository}/pull/${entry.issues.length + entry.pulls.length + 1}`,
        state: "open",
        head,
        headSha: "",
        mergeCommit: null,
        reviews: [],
      };
      entry.pulls.push(pull);
      this.bodies.set(pull.number, body);
      return { ...pull };
    },
    async updatePull(repository, pull, body) {
      calls.push(`updatePull ${repository} #${pull}`);
      const found = repositoryOf(repository).pulls.find((entry) => entry.number === pull);
      if (!found) throw new Error(`pull request ${pull} does not exist`);
      this.bodies.set(pull, body);
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
    async permission(repository, login) {
      calls.push(`permission ${repository} ${login}`);
      return this.permissions.get(`${repository} ${login}`) ?? "none";
    },
    async closedBy(repository, issue) {
      calls.push(`closedBy ${repository} #${issue}`);
      return this.labellers.get(`${repository} #${issue} closed`) ?? null;
    },
    async labelledBy(repository, issue, label) {
      calls.push(`labelledBy ${repository} #${issue} ${label}`);
      return this.labellers.get(`${repository} #${issue} ${label}`) ?? null;
    },
    async login() {
      calls.push("login");
      return "kozo";
    },
    async fetch(clone) {
      calls.push(`fetch ${clone}`);
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
