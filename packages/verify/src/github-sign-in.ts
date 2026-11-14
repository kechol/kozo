/** The gh arguments that report the active sign-in to github.com, through which kozod reaches GitHub. */
export const githubSignInArgs = [
  "auth",
  "status",
  "--active",
  "--hostname=github.com",
  "--json=hosts",
];

/** The login of the active github.com account in the output of `gh` with githubSignInArgs. */
export function activeGitHubLogin(output: string): string | undefined {
  try {
    const raw = JSON.parse(output) as {
      hosts?: Record<string, { active?: boolean; login?: string }[]>;
    };
    return raw.hosts?.["github.com"]?.find((account) => account.active)?.login;
  } catch {
    return undefined;
  }
}
