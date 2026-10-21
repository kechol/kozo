/** A complete, valid Charter with every field set, for tests to start from. */
export const exampleCharter = `version: 1
status: ready
isolation: worktree
protected_paths:
  - "src/auth/**"
  - "**/migrations/**"
  - ".github/**"
  - ".kozo/**"
  - ".claude/**"
  - "AGENTS.md"
existing_tests_protected: true
levels:
  default: L1
  docs: L2
  deps: L2
limits:
  max_changed_lines: 400
  max_files: 8
  max_tasks_per_item: 8
  inner_retries: 2
  ci_fix_rounds: 2
  no_progress_rounds: 3
  max_turns: 40
  max_minutes: 45
  max_cost_usd: 5
backpressure:
  max_awaiting_merge: 3
  max_held: 10
`;
