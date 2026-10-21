export type PullRequest = {
  number: number;
  title: string;
  body: string;
  author: string;
  authorIsBot: boolean;
  headRefName: string;
  createdAt: string;
  readyAt: string;
  mergedAt: string;
  mergeCommit: string | null;
  additions: number;
  deletions: number;
  changedFiles: number;
  reviews: { author: string; submittedAt: string }[];
};

export type Commit = { oid: string; message: string; committedAt: string };

export type PullRequestKind = "change" | "bot" | "release";

// Release pull requests are titled with the version alone ("10.29.5", "11.0.0-rc.1", "Beta.2")
// or as a release chore, and their bodies list the fixed pull requests as release notes.
const releaseTitle =
  /^(?:chore(?:\(release\))?:\s*)?(?:release\b|version packages\b|v?\d+(?:\.\d+)*(?:-\S+)?$|(?:alpha|beta|rc)\.?\d*$)/i;

export function classify(pr: PullRequest): PullRequestKind {
  if (pr.authorIsBot || pr.author.endsWith("[bot]")) return "bot";
  if (pr.headRefName.startsWith("changeset-release/") || releaseTitle.test(pr.title)) {
    return "release";
  }
  return "change";
}

export type Distribution = { count: number; median: number; p90: number };

// Nearest-rank percentiles, so every reported value is one that was observed.
export function distribution(values: number[]): Distribution {
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (p: number) => sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)] ?? 0;
  return { count: sorted.length, median: rank(0.5), p90: rank(0.9) };
}

const hours = (from: string, to: string) => (Date.parse(to) - Date.parse(from)) / 3_600_000;

export function reviewHours(pr: PullRequest): number {
  return hours(pr.readyAt, pr.mergedAt);
}

// Reviews by the author, such as replies in their own thread, are not a review.
export function firstReviewHours(pr: PullRequest): number | null {
  const times = pr.reviews
    .filter((review) => review.author !== pr.author)
    .map((review) => Date.parse(review.submittedAt))
    .filter((time) => time >= Date.parse(pr.readyAt));
  if (times.length === 0) return null;
  return (Math.min(...times) - Date.parse(pr.readyAt)) / 3_600_000;
}

export type DefectLink = {
  target: number;
  kind: "revert" | "fix";
  source: string;
  evidence: string;
};

const fixWords =
  /\b(?:fix(?:es|ed)?|regress(?:ion|ed)?|broke|breaks|caused by|introduced (?:in|by))\b/i;

// A later pull request counts as a fix only when it is one, and not when it ports an
// existing fix to another branch.
const fixTitle = /^(?:fix|hotfix)\b|\bregression\b/i;
const port = /cherry-pick|backport|forward-port/i;

const closingReference = /\b(?:fix(?:es|ed)?|close[sd]?|resolve[sd]?)\s+#(\d+)/gi;

// The sentence that mentions #target must say it was broken; a closing keyword aimed at
// another number, as in "Fixes #5294. Follow-up to #5290.", says nothing about the target.
function blamesTarget(sentence: string, target: number): boolean {
  const rest = sentence.replace(closingReference, (whole, number: string) =>
    Number(number) === target ? whole : "",
  );
  return fixWords.test(rest);
}

// Finds later work that reverts or fixes a merged pull request. Text from the repositories is
// untrusted data and is only matched here, never acted on.
export function findDefectLinks(
  targets: PullRequest[],
  laterPullRequests: PullRequest[],
  commits: Commit[],
): DefectLink[] {
  const byCommit = new Map<string, PullRequest>();
  const byNumber = new Map<number, PullRequest>();
  for (const pr of targets) {
    if (pr.mergeCommit) byCommit.set(pr.mergeCommit.slice(0, 7), pr);
    byNumber.set(pr.number, pr);
  }
  const links = new Map<string, DefectLink>();
  const add = (link: DefectLink) => {
    const key = `${link.target}:${link.kind}:${link.source}`;
    if (!links.has(key)) links.set(key, link);
  };

  for (const commit of commits) {
    for (const match of commit.message.matchAll(/This reverts commit ([0-9a-f]{7,40})/gi)) {
      const target = byCommit.get((match[1] ?? "").slice(0, 7));
      if (target) {
        add({
          target: target.number,
          kind: "revert",
          source: commit.oid.slice(0, 7),
          evidence: match[0],
        });
      }
    }
  }

  for (const later of laterPullRequests) {
    if (classify(later) !== "change") continue;
    const isRevert = /^revert\b/i.test(later.title);
    const isFix = fixTitle.test(later.title) && !port.test(`${later.headRefName} ${later.body}`);
    if (!isRevert && !isFix) continue;
    const sentences = `${later.title}\n${later.body}`.split(/(?<=[.!?])\s+|\n+/);
    for (const sentence of sentences) {
      for (const match of sentence.matchAll(/#(\d+)\b/g)) {
        const target = byNumber.get(Number(match[1]));
        if (!target || target.number === later.number) continue;
        if (Date.parse(later.mergedAt) <= Date.parse(target.mergedAt)) continue;
        if (!isRevert && !blamesTarget(sentence, target.number)) continue;
        add({
          target: target.number,
          kind: isRevert ? "revert" : "fix",
          source: `#${later.number}`,
          evidence: sentence.trim().slice(0, 200),
        });
      }
    }
  }
  return [...links.values()].sort((a, b) => a.target - b.target);
}
