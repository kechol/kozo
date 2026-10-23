import { describe, expect, test } from "bun:test";
import { exampleCharter } from "@kozo/testing";
import { demotedCharter, demotionDue, lowerLevel, promotionProposals } from "./autonomy.ts";
import { type Charter, parseCharter } from "./charter.ts";
import {
  autonomyLevel,
  demotionKey,
  emptyState,
  type FactoryState,
  type TaskState,
} from "./state.ts";

const repository = "/src/shop";
const charterOf = (levels: string): Charter => {
  const parsed = parseCharter(
    exampleCharter.replace(/levels:\n(?: {2}.*\n)+/, `levels:\n${levels}`),
  );
  if (!parsed.ok) throw new Error(parsed.issues.join("; "));
  return parsed.value;
};

/** A state with `count` merged bugfix diffs of the shop, each made by `shape`. */
function merged(count: number, shape: (index: number) => Partial<TaskState> = () => ({})) {
  const state: FactoryState = emptyState();
  for (let index = 1; index <= count; index += 1) {
    const item = `K-${index}`;
    state.items[item] = { ref: item, repository } as FactoryState["items"][string];
    const at = new Date(Date.UTC(2026, 9, 1, 0, index)).toISOString();
    state.tasks[`${item}/t1`] = {
      ref: `${item}/t1`,
      item,
      class: "bugfix",
      humanCommits: false,
      defectAt: null,
      merged: { commit: null, at },
      ...shape(index),
    } as TaskState;
  }
  return state;
}

describe("demotionDue", () => {
  test("is due on a defect, or on more than 30 percent intervention in the last ten", () => {
    expect(demotionDue(merged(3), repository, "bugfix")).toBeNull();
    const defect = merged(3, (index) =>
      index === 2 ? { defectAt: "2026-10-02T00:00:00.000Z" } : {},
    );
    expect(demotionDue(defect, repository, "bugfix")).toBe("a post-merge defect in K-2/t1");
    expect(demotionDue(defect, repository, "docs")).toBeNull();
    const three = merged(10, (index) => ({ humanCommits: index <= 3 }));
    expect(demotionDue(three, repository, "bugfix")).toBeNull();
    const four = merged(10, (index) => ({ humanCommits: index <= 4 }));
    expect(demotionDue(four, repository, "bugfix")).toBe(
      "a human intervened in 4 of the last 10 merged diffs",
    );
    const sentBack = merged(10, (index) => ({ sentBack: index <= 4 }));
    expect(demotionDue(sentBack, repository, "bugfix")).toBe(
      "a human intervened in 4 of the last 10 merged diffs",
    );
    // Fewer than ten diffs are not enough to judge the share.
    expect(
      demotionDue(
        merged(9, () => ({ humanCommits: true })),
        repository,
        "bugfix",
      ),
    ).toBeNull();
  });

  test("counts only what came after the class's last demotion", () => {
    const state = merged(3, (index) =>
      index === 2 ? { defectAt: "2026-10-02T00:00:00.000Z" } : {},
    );
    state.demotions[demotionKey(repository, "bugfix")] = {
      repository,
      class: "bugfix",
      from: "L3",
      to: "L2",
      charterSha: "a".repeat(64),
      reason: "a post-merge defect in K-2/t1",
      at: "2026-10-03T00:00:00.000Z",
    };
    expect(demotionDue(state, repository, "bugfix")).toBeNull();
  });
});

describe("demotedCharter", () => {
  test("applies a demotion while the Charter is the one it demoted from", () => {
    const charter = charterOf("  default: L2\n  bugfix: L3\n");
    const state = emptyState();
    state.demotions[demotionKey(repository, "bugfix")] = {
      repository,
      class: "bugfix",
      from: "L3",
      to: "L2",
      charterSha: "a".repeat(64),
      reason: "x",
      at: "2026-10-03T00:00:00.000Z",
    };
    expect(
      autonomyLevel(demotedCharter(state, repository, charter, "a".repeat(64)), "bugfix"),
    ).toBe("L2");
    expect(
      autonomyLevel(demotedCharter(state, repository, charter, "b".repeat(64)), "bugfix"),
    ).toBe("L3");
    expect(
      autonomyLevel(demotedCharter(state, "/src/other", charter, "a".repeat(64)), "bugfix"),
    ).toBe("L3");
    expect(lowerLevel("L1")).toBeNull();
  });
});

describe("promotionProposals", () => {
  test("proposes L3 for a class at L2 after 20 autonomous diffs without a defect", () => {
    const charter = charterOf("  default: L2\n");
    expect(promotionProposals(merged(20), repository, charter)).toEqual(["bugfix"]);
    expect(promotionProposals(merged(19), repository, charter)).toEqual([]);
    expect(
      promotionProposals(
        merged(20, (index) => ({ humanCommits: index === 20 })),
        repository,
        charter,
      ),
    ).toEqual([]);
    expect(promotionProposals(merged(20), repository, charterOf("  default: L3\n"))).toEqual([]);
    // Sending a diff back is not a commit, so it does not stand in the way of a promotion.
    expect(
      promotionProposals(
        merged(20, () => ({ sentBack: true })),
        repository,
        charter,
      ),
    ).toEqual(["bugfix"]);
  });
});
