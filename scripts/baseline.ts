import { mkdir } from "node:fs/promises";
import { parseArgs } from "node:util";
import { $ } from "bun";
import {
  type Commit,
  classify,
  distribution,
  findDefectLinks,
  firstReviewHours,
  type PullRequest,
  reviewHours,
} from "./baseline/metrics.ts";

// Usage: bun run scripts/baseline.ts --repo honojs/hono --repo preactjs/preact
//          [--until 2026-10-07] [--months 3] [--out .output/baseline]
// Reads public data with the gh CLI and writes nothing to GitHub. The window ends 14 days ago
// by default, so every pull request in it has had time to be reverted or fixed.
const { values } = parseArgs({
  options: {
    repo: { type: "string", multiple: true, default: [] },
    until: { type: "string" },
    months: { type: "string", default: "3" },
    out: { type: "string", default: ".output/baseline" },
  },
});

const until = values.until ? new Date(values.until) : new Date(Date.now() - 14 * 86_400_000);
until.setUTCHours(0, 0, 0, 0);
const since = new Date(until);
since.setUTCMonth(since.getUTCMonth() - Number(values.months));
const day = (date: Date) => date.toISOString().slice(0, 10);

const pullRequestQuery = `
query($q: String!, $cursor: String) {
  search(query: $q, type: ISSUE, first: 50, after: $cursor) {
    issueCount
    pageInfo { hasNextPage endCursor }
    nodes {
      ... on PullRequest {
        number title body headRefName createdAt mergedAt additions deletions changedFiles
        author { __typename login }
        mergeCommit { oid }
        reviews(first: 50) { nodes { author { login } submittedAt } }
        timelineItems(itemTypes: [READY_FOR_REVIEW_EVENT], last: 1) {
          nodes { ... on ReadyForReviewEvent { createdAt } }
        }
      }
    }
  }
}`;

const historyQuery = `
query($owner: String!, $name: String!, $since: GitTimestamp!, $cursor: String) {
  repository(owner: $owner, name: $name) {
    defaultBranchRef {
      target {
        ... on Commit {
          history(since: $since, first: 100, after: $cursor) {
            pageInfo { hasNextPage endCursor }
            nodes { oid message committedDate }
          }
        }
      }
    }
  }
}`;

type PageInfo = { hasNextPage: boolean; endCursor: string | null };

async function graphql<T>(
  query: string,
  variables: Record<string, string>,
  cursor: string | null,
): Promise<{ data: T }> {
  const args = Object.entries(variables).flatMap(([key, value]) => ["-f", `${key}=${value}`]);
  if (cursor) args.push("-f", `cursor=${cursor}`);
  return await $`gh api graphql -f query=${query} ${args}`.quiet().json();
}

type RawPullRequest = {
  number: number;
  title: string;
  body: string;
  headRefName: string;
  createdAt: string;
  mergedAt: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  author: { __typename: string; login: string } | null;
  mergeCommit: { oid: string } | null;
  reviews: { nodes: { author: { login: string } | null; submittedAt: string }[] };
  timelineItems: { nodes: { createdAt?: string }[] };
};

type SearchData = {
  search: { issueCount: number; pageInfo: PageInfo; nodes: RawPullRequest[] };
};

type HistoryData = {
  repository: {
    defaultBranchRef: {
      target: {
        history: {
          pageInfo: PageInfo;
          nodes: { oid: string; message: string; committedDate: string }[];
        };
      };
    };
  };
};

async function fetchPullRequests(repo: string): Promise<PullRequest[]> {
  // Merged since the window opened, through today, so later fixes and reverts are included.
  const q = `repo:${repo} is:pr is:merged merged:>=${day(since)}`;
  const pullRequests: PullRequest[] = [];
  let cursor: string | null = null;
  do {
    const { data }: { data: SearchData } = await graphql<SearchData>(
      pullRequestQuery,
      { q },
      cursor,
    );
    // GitHub search returns at most 1000 results; past that the counts would be silently short.
    if (data.search.issueCount > 1000) throw new Error(`${repo}: narrow the window`);
    for (const raw of data.search.nodes) {
      pullRequests.push({
        number: raw.number,
        title: raw.title,
        body: raw.body,
        author: raw.author?.login ?? "ghost",
        authorIsBot: raw.author?.__typename === "Bot",
        headRefName: raw.headRefName,
        createdAt: raw.createdAt,
        readyAt: raw.timelineItems.nodes[0]?.createdAt ?? raw.createdAt,
        mergedAt: raw.mergedAt,
        mergeCommit: raw.mergeCommit?.oid ?? null,
        additions: raw.additions,
        deletions: raw.deletions,
        changedFiles: raw.changedFiles,
        reviews: raw.reviews.nodes.map((review) => ({
          author: review.author?.login ?? "ghost",
          submittedAt: review.submittedAt,
        })),
      });
    }
    cursor = data.search.pageInfo.hasNextPage ? data.search.pageInfo.endCursor : null;
  } while (cursor);
  return pullRequests;
}

async function fetchCommits(repo: string): Promise<Commit[]> {
  const [owner = "", name = ""] = repo.split("/");
  const commits: Commit[] = [];
  let cursor: string | null = null;
  do {
    const { data }: { data: HistoryData } = await graphql<HistoryData>(
      historyQuery,
      { owner, name, since: since.toISOString() },
      cursor,
    );
    const history: HistoryData["repository"]["defaultBranchRef"]["target"]["history"] =
      data.repository.defaultBranchRef.target.history;
    for (const node of history.nodes) {
      commits.push({ oid: node.oid, message: node.message, committedAt: node.committedDate });
    }
    cursor = history.pageInfo.hasNextPage ? history.pageInfo.endCursor : null;
  } while (cursor);
  return commits;
}

type RepositoryData = { repo: string; pullRequests: PullRequest[]; commits: Commit[] };

function summarize(repositories: RepositoryData[]) {
  const changes: PullRequest[] = [];
  const links: (ReturnType<typeof findDefectLinks>[number] & { repo: string })[] = [];
  let bot = 0;
  let release = 0;
  for (const { repo, pullRequests, commits } of repositories) {
    const inWindow = pullRequests.filter(
      (pr) =>
        Date.parse(pr.mergedAt) >= since.getTime() && Date.parse(pr.mergedAt) < until.getTime(),
    );
    const kinds = Object.groupBy(inWindow, classify);
    const repoChanges = kinds.change ?? [];
    bot += kinds.bot?.length ?? 0;
    release += kinds.release?.length ?? 0;
    changes.push(...repoChanges);
    // Matched per repository, since pull request numbers repeat across repositories.
    for (const link of findDefectLinks(repoChanges, pullRequests, commits)) {
      links.push({ repo, ...link });
    }
  }
  const firstReviews = changes.map(firstReviewHours);
  const defective = new Set(links.map((link) => `${link.repo}#${link.target}`));
  const weeks = (until.getTime() - since.getTime()) / (7 * 86_400_000);
  return {
    pullRequests: {
      change: changes.length,
      bot,
      release,
      changesPerWeek: Number((changes.length / weeks).toFixed(1)),
    },
    reviewHours: distribution(changes.map(reviewHours)),
    firstReviewHours: distribution(firstReviews.filter((hours) => hours !== null)),
    mergedWithoutReview: firstReviews.filter((hours) => hours === null).length,
    changedLines: distribution(changes.map((pr) => pr.additions + pr.deletions)),
    changedFiles: distribution(changes.map((pr) => pr.changedFiles)),
    defects: {
      pullRequests: defective.size,
      rate: changes.length === 0 ? 0 : Number((defective.size / changes.length).toFixed(3)),
      links,
    },
  };
}

await mkdir(values.out, { recursive: true });
const repositories: RepositoryData[] = [];
for (const repo of values.repo) {
  const [pullRequests, commits] = await Promise.all([fetchPullRequests(repo), fetchCommits(repo)]);
  await Bun.write(
    `${values.out}/raw-${repo.replace("/", "-")}.json`,
    JSON.stringify({ pullRequests, commits }, null, 2),
  );
  repositories.push({ repo, pullRequests, commits });
}
const report = {
  window: { since: day(since), until: day(until), followUpThrough: day(new Date()) },
  repositories: Object.fromEntries(repositories.map((data) => [data.repo, summarize([data])])),
  combined: summarize(repositories),
};
await Bun.write(`${values.out}/report.json`, JSON.stringify(report, null, 2));
// The full links are in report.json; the console shows only how many there are.
console.log(JSON.stringify(report, (key, value) => (key === "links" ? value.length : value), 2));
