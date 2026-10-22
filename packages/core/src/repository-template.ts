import workflow from "../../../templates/repository/.github/workflows/kozo.yml" with {
  type: "text",
};
import charter from "../../../templates/repository/.kozo/charter.yml" with { type: "text" };
import constraints from "../../../templates/repository/.kozo/constraints.yml" with { type: "text" };
import verifyApp from "../../../templates/repository/.kozo/verify-app.md" with { type: "text" };
import agents from "../../../templates/repository/AGENTS.md" with { type: "text" };

/**
 * The files `kozo admin install` adds to a repository, by path; `CLAUDE.md` is a symlink to
 * `AGENTS.md` beside them, and the workflow belongs to GitHub mode only.
 */
export const repositoryTemplate = {
  "AGENTS.md": agents,
  ".kozo/charter.yml": charter,
  ".kozo/constraints.yml": constraints,
  ".kozo/verify-app.md": verifyApp,
  ".github/workflows/kozo.yml": workflow,
} as const;

/** The default-branch ruleset kozo asks a GitHub repository's owner to apply. */
export const defaultBranchRuleset = {
  name: "kozo: default branch",
  target: "branch",
  enforcement: "active",
  conditions: { ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] } },
  rules: [
    { type: "deletion" },
    { type: "non_fast_forward" },
    {
      type: "pull_request",
      parameters: {
        required_approving_review_count: 0,
        dismiss_stale_reviews_on_push: false,
        require_code_owner_review: false,
        require_last_push_approval: false,
        required_review_thread_resolution: false,
      },
    },
    {
      type: "required_status_checks",
      parameters: {
        strict_required_status_checks_policy: false,
        required_status_checks: [{ context: "kozo check" }],
      },
    },
  ],
};
