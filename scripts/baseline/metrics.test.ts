import { describe, expect, test } from "bun:test";
import {
  classify,
  distribution,
  findDefectLinks,
  firstReviewHours,
  type PullRequest,
  reviewHours,
} from "./metrics.ts";

function pr(overrides: Partial<PullRequest> = {}): PullRequest {
  return {
    number: 1,
    title: "feat: add a router option",
    body: "",
    author: "alice",
    authorIsBot: false,
    headRefName: "alice/router-option",
    createdAt: "2026-08-01T00:00:00Z",
    readyAt: "2026-08-01T00:00:00Z",
    mergedAt: "2026-08-02T00:00:00Z",
    mergeCommit: "abcdef1234567890",
    additions: 10,
    deletions: 2,
    changedFiles: 1,
    reviews: [],
    ...overrides,
  };
}

describe("classify", () => {
  test("separates bots and releases from changes", () => {
    expect(classify(pr())).toBe("change");
    expect(classify(pr({ authorIsBot: true }))).toBe("bot");
    expect(classify(pr({ author: "renovate[bot]" }))).toBe("bot");
    expect(classify(pr({ headRefName: "changeset-release/main" }))).toBe("release");
    expect(classify(pr({ title: "Version Packages" }))).toBe("release");
    expect(classify(pr({ title: "v4.9.1" }))).toBe("release");
    expect(classify(pr({ title: "chore: release 10.27.0" }))).toBe("release");
    for (const title of ["10.29.5", "11.0.0-rc.1", "11-rc.0", "Beta.2"]) {
      expect(classify(pr({ title }))).toBe("release");
    }
    expect(classify(pr({ title: "fix: release the lock on error" }))).toBe("change");
  });
});

describe("distribution", () => {
  test("reports nearest-rank median and p90", () => {
    expect(distribution([5, 1, 3, 2, 4, 6, 7, 8, 9, 10])).toEqual({
      count: 10,
      median: 5,
      p90: 9,
    });
    expect(distribution([])).toEqual({ count: 0, median: 0, p90: 0 });
  });
});

describe("review times", () => {
  test("measures from ready for review, ignoring the author's own reviews", () => {
    const reviewed = pr({
      readyAt: "2026-08-01T10:00:00Z",
      mergedAt: "2026-08-01T16:00:00Z",
      reviews: [
        { author: "alice", submittedAt: "2026-08-01T11:00:00Z" },
        { author: "bob", submittedAt: "2026-08-01T13:00:00Z" },
        // A review left while the pull request was still a draft does not count.
        { author: "carol", submittedAt: "2026-08-01T09:00:00Z" },
      ],
    });
    expect(reviewHours(reviewed)).toBe(6);
    expect(firstReviewHours(reviewed)).toBe(3);
    expect(firstReviewHours(pr({ reviews: [] }))).toBeNull();
  });
});

describe("findDefectLinks", () => {
  const target = pr({
    number: 100,
    mergeCommit: "1234567deadbeef",
    mergedAt: "2026-08-01T00:00:00Z",
  });

  test("finds a revert commit by the merge commit it reverts", () => {
    const links = findDefectLinks(
      [target],
      [],
      [
        {
          oid: "fedcba9876",
          message: 'Revert "feat: add a router option"\n\nThis reverts commit 1234567deadbeef.',
          committedAt: "2026-08-03T00:00:00Z",
        },
      ],
    );
    expect(links).toMatchObject([{ target: 100, kind: "revert", source: "fedcba9" }]);
  });

  test("finds a later pull request that fixes or reverts the target", () => {
    const later = (number: number, title: string, body = "") =>
      pr({ number, title, body, mergedAt: "2026-08-05T00:00:00Z" });
    const links = findDefectLinks(
      [target],
      [
        later(101, "fix: handle a trailing slash", "This fixes a regression from #100."),
        later(102, "Revert #100"),
        later(103, "docs: mention the option added in #100"),
        // Release notes and ports list the target without blaming it.
        later(104, "10.29.5", "## Fixes\n- Fix a crash (#100, thanks @alice)"),
        later(105, "fix: port the router fix", "Forward-ports the fix from v10.x (#100)."),
        // The closing keyword belongs to another issue.
        later(
          106,
          "fix: unmount parked children",
          "Fixes #200. Follow-up to the gap noted in #100.",
        ),
      ],
      [],
    );
    expect(links.map(({ kind, source }) => ({ kind, source }))).toEqual([
      { kind: "fix", source: "#101" },
      { kind: "revert", source: "#102" },
    ]);
  });

  test("ignores references that come before the target was merged", () => {
    const earlier = pr({
      number: 99,
      title: "fix: something",
      body: "Fixes #100",
      mergedAt: "2026-07-30T00:00:00Z",
    });
    expect(findDefectLinks([target], [earlier], [])).toEqual([]);
  });
});
