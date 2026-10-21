/**
 * The environment that makes git commits in a worktree the factory's own: authored by kozo
 * and unsigned, whatever the owner's configuration says. Claude Code drops GIT_CONFIG_GLOBAL
 * from its shell but keeps keys passed through GIT_CONFIG_COUNT.
 */
export const factoryGitEnvironment: Record<string, string> = {
  GIT_AUTHOR_NAME: "kozo",
  GIT_AUTHOR_EMAIL: "kozo@localhost.invalid",
  GIT_COMMITTER_NAME: "kozo",
  GIT_COMMITTER_EMAIL: "kozo@localhost.invalid",
  GIT_CONFIG_COUNT: "2",
  GIT_CONFIG_KEY_0: "commit.gpgsign",
  GIT_CONFIG_VALUE_0: "false",
  GIT_CONFIG_KEY_1: "tag.gpgsign",
  GIT_CONFIG_VALUE_1: "false",
};
